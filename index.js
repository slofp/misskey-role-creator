import fetch from 'node-fetch';
import WS from 'ws';
import * as Misskey from 'misskey-js';
import { readFileSync } from "fs";

const host = 'https://misskey.secinet.jp'; // https://misskey.art

const token = JSON.parse(readFileSync("token.json", { encoding: "utf-8" }));

const ignoreRole = [
	"束縛"
];

const cli = new Misskey.api.APIClient({
	origin: host,
	credential: token,
	fetch: (...args) => fetch(...args)
});
const ts = new Misskey.Stream(host, { token }, { WebSocket: WS });
const tslt = ts.useChannel("main");

tslt.on("mention", async n => {
	try {
		if (n.user.isBot) return;
		if (n.text == null) return;

		const textLine = n.text.split("\n");
		const command = textLine.shift().trim().toLowerCase();
		if (command === "@rolecreator create") {
			const authorUser = `@${n.user.username}`;
			const data = {
				name: "",
				description: "",
				color: "",
				iconUrl: n.files.length > 0 ? n.files[0].url : "",
				public: true,
				displayBadge: false,
				asignUsers: [
					authorUser
				]
			};
			for (const t of textLine) {
				const property = t.trim().split(":");
				if (property.length < 2) continue;

				const p = property.shift().trim().toLowerCase();
				if (p === "name" || p === "nyame") {
					data.name = property.join(":").trim().replaceAll("`", "");
				}
				else if (p.startsWith("des")) {
					data.description = property.join(":").trim().replaceAll("`", "");
				}
				else if (p.startsWith("col")) {
					data.color = property.join(":").trim();
					if (!/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(data.color)) {
						await cli.request("notes/create", {
							text: `カラーコードが正しくありません`,
							replyId: n.id
						});
						return;
					}
				}
				else if (p.startsWith("icon")) {
					data.iconUrl = property.join(":").trim();
					if (!data.iconUrl.startsWith("http")) {
						try {
							const emoji = await cli.request("emoji", { name: data.iconUrl.replaceAll(":", "") });
							data.iconUrl = emoji.url;
						}
						catch (e) {
							await cli.request("notes/create", {
								text: `絵文字が存在しません`,
								replyId: n.id
							});
							return;
						}
					}
				}
				else if (p.startsWith("pub")) {
					const v = property.join(":").trim().toLowerCase();
					if (v.startsWith("y") || v.startsWith("true")) data.public = true;
					else data.public = false;
				}
				else if (p.startsWith("show")) {
					const v = property.join(":").trim().toLowerCase();
					if (v.startsWith("y") || v.startsWith("true")) data.displayBadge = true;
					else data.displayBadge = false;
				}
				else if (p.startsWith("user")) {
					const v = property.join(":").trim().split(" ").map(v => v.trim()).filter(v => v !== authorUser && v.length !== 0);
					data.asignUsers.push(...v);
				}
			}

			if (data.name.length === 0) {
				await cli.request("notes/create", {
					text: `名前が入力されていません。`,
					replyId: n.id
				});
				return;
			};

			const roleList = await cli.request("admin/roles/list", {});
			for (const role of roleList) {
				if (role.name === data.name) {
					await cli.request("notes/create", {
						text: `${data.name} はすでに登録されています。`,
						replyId: n.id
					});
					return;
				}
			}

			const userIds = [];
			for (const usernameAt of data.asignUsers) {
				const usernameAtSplit = usernameAt.slice(1).split("@");
				const username = usernameAtSplit[0];
				const host = usernameAtSplit.length > 1 ? usernameAtSplit[1] : null;
				if (host != null) {
					await cli.request("notes/create", {
						text: `リモートユーザーには追加できません`,
						replyId: n.id
					});
					return;
				}
				const user = await cli.request("users/show", {
					username,
					host
				});
				if (user.isBot) {
					await cli.request("notes/create", {
						text: `Botには追加できません`,
						replyId: n.id
					});
					return;
				}

				userIds.push(user.id);
			}
			console.log(userIds);

			try {
				const role = await cli.request("admin/roles/create", {
					name: data.name,
					description: data.description,
					color: data.color,
					iconUrl: data.iconUrl,
					displayOrder: 0,
					target: "manual",
					permissionGroup: "Normal",
					isPublic: true,
					isExplorable: true,
					asBadge: data.displayBadge,
					canEditMembersByModerator: data.public,
					condFormula: {},
					policies: {}
				});
				console.log(role.id);

				for (const userId of userIds) {
					await cli.request("admin/roles/assign", {
						expiresAt: null,
						roleId: role.id,
						userId
					});
				}

				await cli.request("notes/create", {
					text: `以下のロールを追加しました！\n名前: ${data.name}\n説明: ${data.description}\n色: ${data.color}\nアイコンURL: ${data.iconUrl}\n誰でも: ${data.public}\nバッチを表示: ${data.displayBadge}\nユーザー: ${data.asignUsers}`,
					replyId: n.id
				});
			}
			catch (e) {
				console.log(e);
				await cli.request("notes/create", {
					text: "```\n" + e + "\n```",
					replyId: n.id
				});
			}
		}
		else if (command === "@rolecreator set") {
			if (textLine.length === 0) {
				await cli.request("notes/create", {
					text: `ロール名を入力してください。`,
					replyId: n.id
				});
				return;
			}
			const roleName = textLine.shift().trim().replaceAll("`", "");

			const setusers = [];
			if (textLine.length !== 0) {
				const property = textLine.shift().trim().split(":");
				if (property.length > 1) {
					const p = property.shift().trim().toLowerCase();
					if (p.startsWith("user")) {
						const v = property.join(":").trim().split(" ").map(v => v.trim()).filter(v => v.length !== 0);
						setusers.push(...v);
					}
				}
			}

			if (ignoreRole.includes(roleName)) {
				await cli.request("notes/create", {
					text: `${roleName} は追加できないようになっています。`,
					replyId: n.id
				});
				return;
			}

			let isMulSet = false;
			const user = await cli.request("users/show", { userId: n.userId });
			for (const role of user.roles) {
				if (role.name === roleName && setusers.length === 0) {
					await cli.request("notes/create", {
						text: `${roleName} はすでに追加されています。`,
						replyId: n.id
					});
					return;
				}
				if (role.isModerator || role.isAdministrator) {
					isMulSet = true;
				}
			}

			const userIds = [];
			if (isMulSet) {
				for (const usernameAt of setusers) {
					const usernameAtSplit = usernameAt.slice(1).split("@");
					const username = usernameAtSplit[0];
					const host = usernameAtSplit.length > 1 ? usernameAtSplit[1] : null;
					if (host != null) {
						await cli.request("notes/create", {
							text: `リモートユーザーには追加できません`,
							replyId: n.id
						});
						return;
					}
					const user = await cli.request("users/show", {
						username,
						host
					});
					if (user.isBot) {
						await cli.request("notes/create", {
							text: `Botには追加できません`,
							replyId: n.id
						});
						return;
					}

					for (const role of user.roles) {
						if (role.name === roleName) {
							await cli.request("notes/create", {
								text: `${user.name} に ${roleName} はすでに追加されています。`,
								replyId: n.id
							});
							return;
						}
					}

					userIds.push(user.id);
				}
			}
			else if (!isMulSet && setusers.length !== 0) {
				await cli.request("notes/create", {
					text: `モデレーター以外はuserプロパティを使用できません`,
					replyId: n.id
				});
				return;
			}

			const roleList = await cli.request("admin/roles/list", {});
			for (const role of roleList) {
				if (role.name === roleName) {
					if (!role.canEditMembersByModerator) {
						await cli.request("notes/create", {
							text: `${roleName} は追加できません。`,
							replyId: n.id
						});
					}
					else if (role.target !== "manual") {
						await cli.request("notes/create", {
							text: `${roleName} はマニュアルではありません。`,
							replyId: n.id
						});
					}
					else {
						if (isMulSet && userIds.length !== 0) {
							for (const userId of userIds) {

								await cli.request("admin/roles/assign", {
									expiresAt: null,
									roleId: role.id,
									userId
								});
							}

							await cli.request("notes/create", {
								text: `${roleName} を追加しました！\nset custom users: ${setusers}`,
								replyId: n.id
							});
						}
						else {
							await cli.request("admin/roles/assign", {
								expiresAt: null,
								roleId: role.id,
								userId: user.id
							});

							await cli.request("notes/create", {
								text: `${roleName} を追加しました！`,
								replyId: n.id
							});
						}
					}
					return;
				}
			}

			await cli.request("notes/create", {
				text: `${roleName} は存在しません。`,
				replyId: n.id
			});
		}
		else if (command === "@rolecreator unset") {
			if (textLine.length === 0) {
				await cli.request("notes/create", {
					text: `ロール名を入力してください。`,
					replyId: n.id
				});
				return;
			}
			const roleName = textLine.shift().trim().replaceAll("`", "");

			if (ignoreRole.includes(roleName)) {
				await cli.request("notes/create", {
					text: `${roleName} は削除できないようになっています。`,
					replyId: n.id
				});
				return;
			}

			const user = await cli.request("users/show", { userId: n.userId });
			for (const role of user.roles) {
				if (role.name === roleName) {
					if (role.isAdministrator || role.isModerator) {
						await cli.request("notes/create", {
							text: `${roleName} はモデレーターロールです。`,
							replyId: n.id
						});
					}
					else {
						const showRole = await cli.request("admin/roles/show", {
							roleId: role.id
						});

						if (showRole.target !== "manual") {
							await cli.request("notes/create", {
								text: `${roleName} はマニュアルではありません。`,
								replyId: n.id
							});
							return;
						}

						if (showRole.usersCount === 1) {
							await cli.request("admin/roles/delete", {
								roleId: role.id
							});

							await cli.request("notes/create", {
								text: `${roleName} を外しました！\nまた、ロールが不要になったため削除されました。`,
								replyId: n.id
							});
						}
						else {
							await cli.request("admin/roles/unassign", {
								roleId: role.id,
								userId: user.id
							});

							await cli.request("notes/create", {
								text: `${roleName} を外しました！`,
								replyId: n.id
							});
						}
					}
					return;
				}
			}

			await cli.request("notes/create", {
				text: `${roleName} は付与されていないか存在しません。`,
				replyId: n.id
			});
		}
		else if (command === "@rolecreator ping") {
			await cli.request("notes/create", {
				text: ":pon_nya:",
				replyId: n.id
			});
		}
		else if (command === "@rolecreator follow") {
			await cli.request("following/create", {
				userId: n.userId
			});
			await cli.request("notes/create", {
				text: "ほいよ",
				replyId: n.id
			});
		}
		else {
			await cli.request("notes/create", {
				text: "なに？\nもしかしたらコマンド違うかもよ",
				replyId: n.id
			});
		}
	}
	catch (e) {
		console.log(e);
		await cli.request("notes/create", {
			text: "```\n" + e + "\n```",
			replyId: n.id
		});
	}
});

ts.on("_connected_", () => {
	console.log("connected!");
});

ts.on("_disconnected_", () => {
	console.log("dis connected...");
});
