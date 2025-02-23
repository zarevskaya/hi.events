/* eslint-disable lingui/no-unlocalized-strings */
import express from "express";
import {installGlobals} from "@remix-run/node";
import process from "process";
import {createServer as viteServer} from "vite";
import compression from "compression";
import fs from "node:fs/promises";
import sirv from "sirv";
import cookieParser from "cookie-parser";

installGlobals();

const base = process.env.BASE || "/";
const port = process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1]
    : process.env.NODE_PORT || 5678;
const isProduction = process.env.NODE_ENV === "production";

const templateHtml = isProduction
    ? await fs.readFile("./dist/client/index.html", "utf-8")
    : "";

const ssrManifest = isProduction
    ? await fs.readFile("./dist/client/.vite/ssr-manifest.json", "utf-8")
    : undefined;

const app = express();
app.use(cookieParser());

let vite;

if (!isProduction) {
    vite = await viteServer({
        server: {middlewareMode: true},
        appType: "custom",
        base,
    });

    app.use(vite.middlewares);
} else {
    app.use(compression());
    app.use(base, sirv("./dist/client", {extensions: []}));
}

const getViteEnvironmentVariables = () => {
    const envVars = {};
    for (const key in process.env) {
        if (key.startsWith('VITE_')) {
            envVars[key] = process.env[key];
        }
    }
    return JSON.stringify(envVars);
};

app.use("*", async (req, res) => {
    const url = req.originalUrl.replace(base, "");

    try {
        let template;
        let render;

        if (!isProduction) {
            template = await fs.readFile("./index.html", "utf-8");
            template = await vite.transformIndexHtml(url, template);
            render = (await vite.ssrLoadModule("/src/entry.server.tsx")).render;
        } else {
            template = templateHtml;
            render = (await import("./dist/server/entry.server.js")).render;
        }

        const {appHtml, dehydratedState, helmetContext} = await render(
            {req, res},
            ssrManifest
        );
        const stringifiedState = JSON.stringify(dehydratedState);

        const helmetHtml = Object.values(helmetContext.helmet || {})
            .map((value) => value.toString() || "")
            .join(" ");

        const envVariablesHtml = `<script>window.hievents = ${getViteEnvironmentVariables()};</script>`;

        const html = template
            .replace("<!--app-html-->", appHtml)
            .replace("<!--dehydrated-state-->", `<script>window.__REHYDRATED_STATE__ = ${stringifiedState}</script>`)
            .replace("<!--environment-variables-->", envVariablesHtml)
            .replace(/<!--render-helmet-->.*?<!--\/render-helmet-->/s, helmetHtml);

        res.setHeader("Content-Type", "text/html");
        return res.status(200).end(html);
    } catch (error) {
        if (!isProduction) {
            vite.ssrFixStacktrace(error);
        }
        console.log(error.stack);
        res.status(500).end(error.stack);
    }
});

app.listen(port, () => {
    console.info(`SSR Serving at http://localhost:${port}`);
});
