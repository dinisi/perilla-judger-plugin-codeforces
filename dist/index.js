"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require("debug");
const fs_1 = require("fs");
const jsdom_1 = require("jsdom");
const path_1 = require("path");
const randomstring_1 = require("randomstring");
const SocksProxyAgent = require("socks-proxy-agent");
const superagent_1 = require("superagent");
const interfaces_1 = require("./interfaces");
const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 1000;
const configPath = path_1.join(__dirname, "..", "config.json");
const config = JSON.parse(fs_1.readFileSync(configPath).toString());
const agent = superagent_1.agent();
const log = debug("perilla:judger:plugin:codeforces");
const proxyWarp = (request) => {
    if (config.proxy) {
        request = request.agent(new SocksProxyAgent(config.proxy));
    }
    return request;
};
const isLoggedIn = async () => {
    const result = await proxyWarp(agent
        .get("https://codeforces.com/enter")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"));
    return !!result.redirects.length;
};
const initRequest = async () => {
    const loginPage = await proxyWarp(agent
        .get("https://codeforces.com/enter")
        .set("Host", "codeforces.com")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"));
    const csrf = /name="X-Csrf-Token" content="(.+)"/.exec(loginPage.text)[1];
    log(csrf);
    await proxyWarp(agent
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
        .send("password=" + encodeURIComponent(config.password)));
    if (!await isLoggedIn()) {
        throw new Error("Login failed");
    }
    log("Done");
};
const generateBlankString = () => {
    return randomstring_1.generate({ length: 10, charset: " \t\r\n" });
};
const submit = async (id, code, langname) => {
    try {
        code = generateBlankString() + code + generateBlankString();
        const contest = id.substr(0, id.length - 1);
        const problem = id.substr(-1);
        const URL = `https://codeforces.com/problemset/problem/${contest}/${problem}`;
        const problemPage = await proxyWarp(agent
            .get(URL)
            .set("Host", "codeforces.com")
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"));
        const csrf = /name="X-Csrf-Token" content="(.+)"/.exec(problemPage.text)[1];
        log(csrf);
        const submissions = await proxyWarp(agent
            .post(`https://codeforces.com/problemset/submit?csrf_token=${csrf}`)
            .set("Host", "codeforces.com")
            .set("Origin", "https://codeforces.com")
            .set("Referer", URL)
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36")
            .send("csrf_token=" + encodeURIComponent(csrf))
            .send("ftaa=")
            .send("bfaa=")
            .send("action=submitSolutionFormSubmitted")
            .send("contestId=" + encodeURIComponent(contest))
            .send("submittedProblemIndex=" + encodeURIComponent(problem))
            .send("programTypeId=" + encodeURIComponent(langname))
            .send("source=" + encodeURIComponent(code))
            .send("tabSize=4"));
        const dom = new jsdom_1.JSDOM(submissions.text);
        const resultTable = dom.window.document.querySelector("#pageContent > div.datatable > div:nth-child(6) > table > tbody");
        for (let i = 1; i < resultTable.children.length; i++) {
            const resultRow = resultTable.children[i];
            if (resultRow.children[2].textContent.trim() !== config.username) {
                continue;
            }
            return [contest, resultRow.children[0].textContent.trim()].join("_");
        }
        throw new Error("Submit failed");
    }
    catch (e) {
        throw e;
    }
};
const updateMap = new Map();
const convertStatus = (text) => {
    const _ = (strs) => {
        for (const str of strs) {
            if (text.startsWith(str)) {
                return true;
            }
        }
    };
    if (_(["Happy New Year!", "Accepted"])) {
        return interfaces_1.SolutionResult.Accepted;
    }
    if (_(["Rejected", "Judgement failed", "Denial of judgement"])) {
        return interfaces_1.SolutionResult.JudgementFailed;
    }
    if (_(["Wrong answer", "Hacked", "Partial"])) {
        return interfaces_1.SolutionResult.WrongAnswer;
    }
    if (_(["Runtime error", "Security violated", "Input preparation failed"])) {
        return interfaces_1.SolutionResult.RuntimeError;
    }
    if (_(["Time limit exceeded", "Idleness limit exceeded"])) {
        return interfaces_1.SolutionResult.TimeLimitExceeded;
    }
    if (_(["Memory limit exceeded"])) {
        return interfaces_1.SolutionResult.MemoryLimitExceeded;
    }
    if (_(["Compilation error"])) {
        return interfaces_1.SolutionResult.CompileError;
    }
    if (_(["Presentation error"])) {
        return interfaces_1.SolutionResult.PresentationError;
    }
    if (_(["Skipped"])) {
        return interfaces_1.SolutionResult.Skipped;
    }
    if (_(["Running"])) {
        return interfaces_1.SolutionResult.Judging;
    }
    if (_(["In queue", "Pending"])) {
        return interfaces_1.SolutionResult.WaitingJudge;
    }
    return interfaces_1.SolutionResult.OtherError;
};
const fetch = async (runID) => {
    try {
        const [contest, sid] = runID.split("_");
        const URL = `https://codeforces.com/problemset/submission/${contest}/${sid}`;
        const submissionPage = await proxyWarp(agent
            .get(URL)
            .set("Host", "codeforces.com")
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"));
        const dom = new jsdom_1.JSDOM(submissionPage.text);
        const resultRow = dom.window.document.querySelector("#pageContent > div.datatable > div:nth-child(6) > table > tbody > tr:nth-child(2)");
        const status = convertStatus(resultRow.children[4].textContent.trim());
        const score = status === interfaces_1.SolutionResult.Accepted ? 100 : 0;
        const result = {
            status,
            score,
            details: {
                runID,
                time: resultRow.children[5].textContent.trim(),
                memory: resultRow.children[6].textContent.trim(),
                submitTime: resultRow.children[7].textContent.trim(),
                judgeTime: resultRow.children[8].textContent.trim(),
            },
        };
        return result;
    }
    catch (e) {
        throw e;
    }
};
const updateSolutionResults = async () => {
    for (const [runid, cb] of updateMap) {
        try {
            const result = await fetch(runid);
            cb(result);
            if (result.status !== interfaces_1.SolutionResult.Judging && result.status !== interfaces_1.SolutionResult.WaitingJudge) {
                updateMap.delete(runid);
            }
        }
        catch (e) {
            cb({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message, runID: runid } });
        }
    }
    setTimeout(updateSolutionResults, UPDATE_INTERVAL);
};
const convertLanguage = (language) => {
    switch (language) {
        case "c": return "43";
        case "cpp11": return "42";
        case "cpp14": return "50";
        case "cpp17": return "54";
        case "csharp": return "9";
        case "go": return "32";
        case "java": return "36";
        case "python2": return "7";
        case "python3": return "31";
        case "node": return "55";
    }
    return null;
};
const main = async (problem, solution, resolve, update) => {
    if (interfaces_1.Problem.guard(problem)) {
        if (interfaces_1.Solution.guard(solution)) {
            if (!await isLoggedIn()) {
                try {
                    await initRequest();
                }
                catch (e) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
                }
            }
            try {
                const langname = convertLanguage(solution.language);
                if (langname === null) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Language rejected" } });
                }
                const source = await resolve(solution.file);
                const stat = fs_1.statSync(source.path);
                if (stat.size > MAX_SOURCE_SIZE) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "File is too big" } });
                }
                const content = fs_1.readFileSync(source.path).toString();
                const runID = await submit(problem.id, content, langname);
                updateMap.set(runID, update);
            }
            catch (e) {
                log(e.message);
                return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
            }
        }
        else {
            return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
        }
    }
    else {
        return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid problem" } });
    }
};
module.exports = main;
updateSolutionResults();
//# sourceMappingURL=index.js.map