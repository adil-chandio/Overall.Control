// Headless-render GEHRAI: records the live 3D animation to a webm file.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fs from "node:fs";

const OUT = "render/gehrai-raw.webm";
const URL = "http://localhost:5173/?auto=1";
const RECORD_SECONDS = 130; // DURATION (126s) + tail

fs.mkdirSync("render", { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
console.log("canvas found, starting recording...");

await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 6_000_000,
  });
  window.__chunks = [];
  window.__rec = rec;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) window.__chunks.push(e.data); };
  rec.start(500);
});

// wait until the end card shows (animation finished) or timeout
await page.waitForFunction(
  () => {
    const el = document.getElementById("end-card");
    return el && !el.classList.contains("hidden");
  },
  { timeout: (RECORD_SECONDS + 20) * 1000, polling: 1000 }
).catch(() => console.log("timeout waiting for end card — stopping anyway"));

const dataUrl = await page.evaluate(
  () =>
    new Promise((res) => {
      const rec = window.__rec;
      rec.onstop = () => {
        const blob = new Blob(window.__chunks, { type: "video/webm" });
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      };
      rec.stop();
    })
);

const base64 = dataUrl.split(",")[1];
fs.writeFileSync(OUT, Buffer.from(base64, "base64"));
console.log("saved", OUT, (fs.statSync(OUT).size / 1e6).toFixed(1), "MB");

await browser.close();
process.exit(0);
