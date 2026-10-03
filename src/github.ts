export type Cfg = { owner: string; repo: string; branch: string; token: string };
export type Game = { block: string; index: number; url: string; img: string; title: string };
export type Input = { title: string; file?: File | null; link: string; imgF?: File | null; imgU: string };
type Log = (message: string) => void;

const KEY = "yoshi-github";
const defaults: Cfg = { owner: "YoshiJunior", repo: "YoshiJunior.github.io", branch: "main", token: "" };

export const getCfg = (): Cfg => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return defaults;
  }
};
export const saveCfg = (cfg: Cfg) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable */
  }
};

/* ---------- helpers ---------- */
const slugify = (s: string) =>
  (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export const isExternal = (u: string) => /^https?:\/\//i.test(u);
const isLocalGame = (u: string) => u.startsWith("games/");
const isLocalImage = (u: string) => u.startsWith("images/");
const ext = (name: string) => (name.match(/\.[^.]+$/) || [".png"])[0].toLowerCase();
export const normalizeLink = (v: string) => {
  const t = (v || "").trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("/") || t.startsWith(".") ? t : `https://${t}`;
};

const bytesToB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
};
const textToB64 = (t: string) => bytesToB64(new TextEncoder().encode(t));
const b64ToText = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const fileToB64 = async (f: File) => bytesToB64(new Uint8Array(await f.arrayBuffer()));

/* ---------- GitHub API ---------- */
async function gh(cfg: Cfg, path: string, opts: { method?: string; body?: string; allow404?: boolean } = {}) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`;
  const auths = cfg.token ? [`Bearer ${cfg.token}`, `token ${cfg.token}`] : [null];
  let last: Error | null = null;
  for (const auth of auths) {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (auth) headers.Authorization = auth;
    if (opts.body) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method: opts.method, body: opts.body, headers });
    if (res.status === 404 && opts.allow404) return null;
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const detail = (data && data.message) || res.statusText;
    last = new Error(`${res.status} ${detail}`);
    if (res.status !== 401 && res.status !== 403 && !/bad credentials/i.test(detail)) throw last;
  }
  throw new Error(
    `${last?.message}\nMake sure the token has access to this repository with Contents: Read and write (or the repo scope for classic tokens).`,
  );
}

const getFile = (cfg: Cfg, path: string) => gh(cfg, `contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`, { allow404: true });

async function putFile(cfg: Cfg, path: string, b64: string, message: string, sha?: string) {
  if (sha === undefined) sha = (await getFile(cfg, path))?.sha;
  return gh(cfg, `contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64, branch: cfg.branch, ...(sha ? { sha } : {}) }),
  });
}

async function removeFile(cfg: Cfg, path: string, message: string, log: Log) {
  const f = await getFile(cfg, path);
  if (!f) return log(`${path} was already gone.`);
  await gh(cfg, `contents/${encodeURI(path)}`, { method: "DELETE", body: JSON.stringify({ message, sha: f.sha, branch: cfg.branch }) });
  log(`Deleted ${path}.`);
}

async function fetchIndex(cfg: Cfg) {
  const f = await getFile(cfg, "index.html");
  if (!f) throw new Error("index.html was not found on this branch.");
  return { sha: f.sha as string, text: b64ToText(f.content) };
}

/* ---------- index.html cards ---------- */
const CARD_RE = /<div class="game-card"[^>]*>\s*<img[^>]*>\s*<div class="game-info">\s*<h3>[\s\S]*?<\/h3>\s*<\/div>\s*<\/div>/g;

function parseCards(html: string): Game[] {
  return [...html.matchAll(CARD_RE)].map((m) => {
    const b = m[0];
    return {
      block: b,
      index: m.index ?? 0,
      url: unesc((b.match(/data-url="([^"]*)"/) || [])[1] || ""),
      img: unesc((b.match(/<img[^>]*?\ssrc="([^"]*)"/) || [])[1] || ""),
      title: unesc((b.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || "").trim(),
    };
  });
}

const buildCard = (title: string, url: string, img: string) =>
  `<div class="game-card" data-url="${esc(url)}">\n` +
  `                    <img src="${esc(img)}" alt="${esc(title)}">\n` +
  `                    <div class="game-info">\n` +
  `                        <h3>${esc(title)}</h3>\n` +
  `                    </div>\n` +
  `                </div>`;

function editBlock(b: string, v: { title: string; url: string; img: string }) {
  return b
    .replace(/(data-url=")[^"]*(")/, (_m, a, z) => a + esc(v.url) + z)
    .replace(/(<img[^>]*?\ssrc=")[^"]*(")/, (_m, a, z) => a + esc(v.img) + z)
    .replace(/(<img[^>]*?\salt=")[^"]*(")/, (_m, a, z) => a + esc(v.title) + z)
    .replace(/(<h3>)[\s\S]*?(<\/h3>)/, (_m, a, z) => a + esc(v.title) + z);
}

function findCard(cards: Game[], sel: Game) {
  const c = cards.find((x) => x.url === sel.url && x.title === sel.title) || cards.find((x) => x.url === sel.url);
  if (!c) throw new Error("That game is no longer on the homepage. Reload the list and try again.");
  return c;
}

const wrapper = (u: string, title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(title || "Yoshi's")}</title>
  <link rel="icon" type="image/x-icon" href="favicon.png">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: black;
      overflow: hidden;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>

<iframe
  src="${esc(u)}"
  allow="fullscreen; autoplay; gamepad">
</iframe>

</body>
</html>
`;

/* ---------- public actions ---------- */
export async function loadGames(cfg: Cfg): Promise<Game[]> {
  if (!cfg.token) throw new Error("Add your GitHub token in Settings first.");
  return parseCards((await fetchIndex(cfg)).text);
}

export async function addGame(cfg: Cfg, i: Input, log: Log) {
  const title = i.title.trim();
  const link = normalizeLink(i.link);
  const imgU = i.imgU.trim();
  if (!title) throw new Error("Enter a game name.");
  if (i.file && link) throw new Error("Choose either an HTML file or a link, not both.");
  if (!i.file && !link) throw new Error("Add a game HTML file or a game link.");
  if (i.imgF && imgU) throw new Error("Choose either an image file or an image URL, not both.");
  if (!i.imgF && !imgU) throw new Error("Add an image file or an image URL.");

  const slug = slugify(title) || "new-game";
  const htmlPath = `games/${slug}.html`;
  const imgSrc = imgU || `images/${slug}${i.imgF ? ext(i.imgF.name) : ".png"}`;
  if (await getFile(cfg, htmlPath)) throw new Error(`${htmlPath} already exists. Pick a different name, or use Edit.`);

  const msg = `Add game: ${title}`;
  log(`Uploading ${htmlPath}...`);
  await putFile(cfg, htmlPath, i.file ? await fileToB64(i.file) : textToB64(wrapper(link, title)), msg);
  if (!imgU && i.imgF) {
    log(`Uploading ${imgSrc}...`);
    await putFile(cfg, imgSrc, await fileToB64(i.imgF), msg);
  }

  log("Adding the card to index.html...");
  const idx = await fetchIndex(cfg);
  const cards = parseCards(idx.text);
  if (!cards.length) throw new Error("Could not find the game grid in index.html.");
  const last = cards[cards.length - 1];
  const end = last.index + last.block.length;
  const html = idx.text.slice(0, end) + "\n                " + buildCard(title, htmlPath, imgSrc) + idx.text.slice(end);
  await putFile(cfg, "index.html", textToB64(html), msg, idx.sha);
}

export async function changeGame(cfg: Cfg, sel: Game | null, i: Input, log: Log) {
  if (!sel) throw new Error("Pick a game to edit.");
  const title = i.title.trim();
  const link = normalizeLink(i.link);
  const imgU = i.imgU.trim();
  if (!title) throw new Error("The title cannot be empty.");
  if (i.file && link) throw new Error("Choose either an HTML file or a link, not both.");
  if (i.imgF && imgU) throw new Error("Choose either an image file or an image URL, not both.");
  if (title === sel.title && !i.file && !link && !i.imgF && !imgU) throw new Error("Nothing to change yet.");

  const local = isLocalGame(sel.url);
  const slug = local ? sel.url.replace(/^games\//, "").replace(/\.html?$/i, "") : slugify(title || sel.title) || "game";
  const htmlPath = local ? sel.url : i.file ? `games/${slug}.html` : null;
  const dataUrl = local ? sel.url : i.file ? (htmlPath as string) : link || sel.url;
  const imgSrc = imgU || (i.imgF ? `images/${slug}${ext(i.imgF.name)}` : sel.img);
  const msg = `Update game: ${sel.title}`;

  if (i.file && htmlPath) {
    log(`Uploading ${htmlPath}...`);
    await putFile(cfg, htmlPath, await fileToB64(i.file), msg);
  } else if (link && local && htmlPath) {
    log(`Rewriting ${htmlPath} with the new link...`);
    await putFile(cfg, htmlPath, textToB64(wrapper(link, title)), msg);
  }
  if (!imgU && i.imgF) {
    log(`Uploading ${imgSrc}...`);
    await putFile(cfg, imgSrc, await fileToB64(i.imgF), msg);
  }

  log("Updating index.html...");
  const idx = await fetchIndex(cfg);
  const cards = parseCards(idx.text);
  const c = findCard(cards, sel);
  const block = editBlock(c.block, { title, url: dataUrl, img: imgSrc });
  await putFile(cfg, "index.html", textToB64(idx.text.slice(0, c.index) + block + idx.text.slice(c.index + c.block.length)), msg, idx.sha);

  if (imgSrc !== sel.img && isLocalImage(sel.img) && !cards.some((o) => o !== c && o.img === sel.img)) {
    try {
      await removeFile(cfg, sel.img, `Remove old image for ${sel.title}`, log);
    } catch (err) {
      log(`Could not delete the old image (${(err as Error).message}). It is harmless to leave.`);
    }
  }
}

export async function removeGame(cfg: Cfg, sel: Game | null, log: Log) {
  if (!sel) throw new Error("Pick a game to remove.");
  const msg = `Remove game: ${sel.title}`;
  log("Removing the card from index.html...");
  const idx = await fetchIndex(cfg);
  const cards = parseCards(idx.text);
  const c = findCard(cards, sel);
  const before = idx.text.slice(0, c.index).replace(/\s+$/, "");
  await putFile(cfg, "index.html", textToB64(before + idx.text.slice(c.index + c.block.length)), msg, idx.sha);

  const others = cards.filter((o) => o !== c);
  const targets: string[] = [];
  if (isLocalGame(sel.url) && !others.some((o) => o.url === sel.url)) targets.push(sel.url);
  if (isLocalImage(sel.img) && !others.some((o) => o.img === sel.img)) targets.push(sel.img);
  for (const path of targets) {
    try {
      await removeFile(cfg, path, msg, log);
    } catch (err) {
      log(`Could not delete ${path}: ${(err as Error).message}`);
    }
  }
}
