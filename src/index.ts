import debug = require("debug");
import { readFileSync, statSync } from "fs";
import { JSDOM } from "jsdom";
import { join } from "path";
import { generate } from "randomstring";
import SocksProxyAgent = require("socks-proxy-agent");
import { agent as createAgent, SuperAgentRequest } from "superagent";
import { ISolution, JudgeFunction, Problem, Solution, SolutionResult } from "./interfaces";

const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 1000;

const configPath = join(__dirname, "..", "config.json");
const config = JSON.parse(readFileSync(configPath).toString());

const agent = createAgent();
const log = debug("perilla:judger:plugin:codeforces");

const proxyWarp = (request: SuperAgentRequest) => {
    if (config.proxy) {
        request = request.agent(new SocksProxyAgent(config.proxy));
    }
    return request;
};

const isLoggedIn = async () => {
    const result = await proxyWarp(agent
        .get("https://codeforces.com/enter")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36")) as any;
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
    if (!await isLoggedIn()) { throw new Error("Login failed"); }
    log("Done");
};

const generateBlankString = () => {
    return generate({ length: 10, charset: " \t\r\n" });
};

const submit = async (id: string, code: string, langname: string) => {
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
        const dom = new JSDOM(submissions.text);
        const resultTable = dom.window.document.querySelector("#pageContent > div.datatable > div:nth-child(6) > table > tbody");
        for (let i = 1; i < resultTable.children.length; i++) {
            const resultRow = resultTable.children[i];
            if (resultRow.children[2].textContent.trim() !== config.username) { continue; }
            return [contest, resultRow.children[0].textContent.trim()].join("_");
        }
        throw new Error("Submit failed");
    } catch (e) {
        throw e;
    }
};
const updateMap = new Map<string, (solution: ISolution) => Promise<void>>();

const convertStatus = (text: string) => {
    const _ = (strs: string[]) => {
        for (const str of strs) {
            if (text.startsWith(str)) { return true; }
        }
    };
    if (_(["Happy New Year!", "Accepted"])) { return SolutionResult.Accepted; }
    if (_(["Rejected", "Judgement failed", "Denial of judgement"])) { return SolutionResult.JudgementFailed; }
    if (_(["Wrong answer", "Hacked", "Partial"])) { return SolutionResult.WrongAnswer; }
    if (_(["Runtime error", "Security violated", "Input preparation failed"])) { return SolutionResult.RuntimeError; }
    if (_(["Time limit exceeded", "Idleness limit exceeded"])) { return SolutionResult.TimeLimitExceeded; }
    if (_(["Memory limit exceeded"])) { return SolutionResult.MemoryLimitExceeded; }
    if (_(["Compilation error"])) { return SolutionResult.CompileError; }
    if (_(["Presentation error"])) { return SolutionResult.PresentationError; }
    if (_(["Skipped"])) { return SolutionResult.Skipped; }
    if (_(["Running"])) { return SolutionResult.Judging; }
    if (_(["In queue", "Pending"])) { return SolutionResult.WaitingJudge; }
    return SolutionResult.OtherError;
};

const fetch = async (runID: string) => {
    try {
        const [contest, sid] = runID.split("_");
        const URL = `https://codeforces.com/problemset/submission/${contest}/${sid}`;
        const submissionPage = await proxyWarp(agent
            .get(URL)
            .set("Host", "codeforces.com")
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"));
        const dom = new JSDOM(submissionPage.text);
        const resultRow = dom.window.document.querySelector("#pageContent > div.datatable > div:nth-child(6) > table > tbody > tr:nth-child(2)");
        // const { status, score } = convertStatus(resultRow.childNodes[3].textContent.trim());
        const status = convertStatus(resultRow.children[4].textContent.trim());
        const score = status === SolutionResult.Accepted ? 100 : 0;
        const result: ISolution = {
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
    } catch (e) {
        throw e;
    }
};

const updateSolutionResults = async () => {
    for (const [runid, cb] of updateMap) {
        try {
            const result = await fetch(runid);
            cb(result);
            if (result.status !== SolutionResult.Judging && result.status !== SolutionResult.WaitingJudge) {
                updateMap.delete(runid);
            }
        } catch (e) {
            cb({ status: SolutionResult.JudgementFailed, score: 0, details: { error: e.message, runID: runid } });
        }
    }
    setTimeout(updateSolutionResults, UPDATE_INTERVAL);
};

const convertLanguage = (language: string) => {
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

const main: JudgeFunction = async (problem, solution, resolve, update) => {
    if (Problem.guard(problem)) {
        if (Solution.guard(solution)) {
            if (!await isLoggedIn()) {
                try {
                    await initRequest();
                } catch (e) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
                }
            }
            try {
                const langname = convertLanguage(solution.language);
                if (langname === null) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Language rejected" } });
                }
                const source = await resolve(solution.file);
                const stat = statSync(source.path);
                if (stat.size > MAX_SOURCE_SIZE) {
                    return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "File is too big" } });
                }
                const content = readFileSync(source.path).toString();
                const runID = await submit(problem.id, content, langname);
                updateMap.set(runID, update);
            } catch (e) {
                log(e.message);
                return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
            }
        } else {
            return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
        }
    } else {
        return update({ status: SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid problem" } });
    }
};

module.exports = main;

updateSolutionResults();
