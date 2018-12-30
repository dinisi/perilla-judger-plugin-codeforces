"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require("debug");
const fs_1 = require("fs");
const path_1 = require("path");
const superagent_1 = require("superagent");
const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 1000;
const configPath = path_1.join(__dirname, "..", "config.json");
const config = JSON.parse(fs_1.readFileSync(configPath).toString());
const agent = superagent_1.agent();
const log = debug("perilla:judger:plugin:uoj");
const isLoggedIn = async () => {
    const result = await agent
        .get("https://codeforces.com/enter")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36");
    return !!result.redirects.length;
};
const initRequest = async () => {
    const loginPage = await agent
        .get("https://codeforces.com/enter")
        .set("Host", "codeforces.com")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36");
    const csrf = /name="X-Csrf-Token" content="(.+)"/.exec(loginPage.text)[1];
    log(csrf);
    await agent
        .post("https://codeforces.com/enter")
        .set("Host", "codeforces.com")
        .set("Origin", "https://codeforces.com")
        .set("Referer", "https://codeforces.com/enter")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36")
        .send("csrf_token=" + encodeURIComponent(csrf))
        .send("action=enter")
        .send("ftaa=")
        .send("bfaa=")
        .send("handleOrEmail=" + encodeURIComponent(config.username))
        .send("password=" + encodeURIComponent(config.password));
    if (!await isLoggedIn()) {
        throw new Error("Login failed");
    }
    log("Done");
};
(async () => {
    await initRequest();
})();
//# sourceMappingURL=index.js.map