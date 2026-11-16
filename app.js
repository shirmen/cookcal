const KEY = "recipe-box-v1";
const $ = (id) => document.getElementById(id);
const PKEY = "recipe-box-plan-v1";
const CFG = window.COOKCAL_FIREBASE;
const REMOTE = !!(CFG && CFG.apiKey && !/^YOUR/.test(CFG.apiKey));
if (REMOTE) document.documentElement.dataset.auth = "out";
let db,
  fs,
  auth,
  authApi,
  signedInUser = null;
if (REMOTE) {
  const V = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [app, f, a] = await Promise.all([
    import(V + "firebase-app.js"),
    import(V + "firebase-firestore.js"),
    import(V + "firebase-auth.js"),
  ]);
  const inst = app.initializeApp(CFG);
  db = f.getFirestore(inst);
  fs = f;
  auth = a.getAuth(inst);
  authApi = a;
}
const fail = (e) => {
  console.error(e);
  alert("Could not save: " + (e.code === "permission-denied" ? "permission denied." : e.message));
};
let recipes;
if (REMOTE) recipes = [];
else
  try {
    recipes = JSON.parse(localStorage.getItem(KEY));
  } catch {}
if (!Array.isArray(recipes)) {
  recipes = [
    {
      id: 1,
      emoji: "🍝",
      title: "Garlic Butter Pasta",
      ing: ["200g spaghetti", "3 tbsp butter", "4 cloves garlic", "Parmesan", "Parsley"],
      steps: [
        "Boil pasta until al dente.",
        "Melt butter and sauté garlic for 1 minute.",
        "Toss pasta with sauce and a splash of pasta water.",
        "Top with Parmesan and parsley.",
      ],
    },
    {
      id: 2,
      emoji: "🥞",
      title: "Fluffy Pancakes",
      ing: [
        "1½ cups flour",
        "1 tbsp sugar",
        "2 tsp baking powder",
        "1¼ cups milk",
        "1 egg",
        "3 tbsp melted butter",
      ],
      steps: [
        "Whisk dry ingredients.",
        "Mix in milk, egg and butter until just combined.",
        "Cook ¼ cup scoops on a hot griddle, flipping when bubbly.",
      ],
    },
    {
      id: 3,
      emoji: "🥗",
      title: "Greek Salad",
      ing: ["Cucumber", "Tomatoes", "Red onion", "Kalamata olives", "Feta", "Olive oil & oregano"],
      steps: [
        "Chop vegetables into chunks.",
        "Combine with olives.",
        "Dress with oil and oregano, top with feta.",
      ],
    },
  ];
  save();
}
let remoteSnap = new Map();
const norm = (r) => JSON.parse(JSON.stringify({ ...r, id: String(r.id) }));
function pushRecipes() {
  if (!signedInUser) return;
  const cur = new Map(recipes.map((r) => [String(r.id), norm(r)]));
  for (const [id, r] of cur)
    if (remoteSnap.get(id) !== JSON.stringify(r))
      fs.setDoc(fs.doc(db, "recipes", id), r).catch(fail);
  for (const id of remoteSnap.keys())
    if (!cur.has(id)) fs.deleteDoc(fs.doc(db, "recipes", id)).catch(fail);
}
function save() {
  if (REMOTE) {
    if (!signedInUser) {
      alert("Sign in from the Account tab to edit shared recipes.");
      return false;
    }
    pushRecipes();
    return true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(recipes));
    return true;
  } catch {
    alert("Storage is full — try a smaller photo or delete a recipe.");
    return false;
  }
}
let photo = null;
function shrink(file) {
  return new Promise((res) => {
    const img = new Image(),
      url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 720 / img.width),
        c = document.createElement("canvas");
      c.width = img.width * s;
      c.height = img.height * s;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.8));
    };
    img.src = url;
  });
}
let photoFile = null;
async function pick(f) {
  if (!f || !f.type.startsWith("image/")) return;
  photoFile = f;
  $("scanBtn").hidden = false;
  photo = await shrink(f);
  $("drop").style.backgroundImage = `url(${photo})`;
  $("drop").classList.add("has");
  $("drop").querySelector("span").textContent = "Change photo";
}
$("file").onchange = (e) => pick(e.target.files[0]);
const drop = $("drop");
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("over");
};
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  pick(e.dataTransfer.files[0]);
};

const lines = (s) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const status = (m) => {
  $("status").textContent = m || "";
};
// Full-screen blocking overlay for long operations; pass nothing to dismiss.
const busy = (m) => {
  $("busy").hidden = !m;
  $("busyMsg").textContent = m || "";
  document.querySelector("main").inert = !!m;
};
const BULLET = /^\s*(?:[-*•·▪◦□☐]|\d+[.)])\s+/;
const clean = (s) => s.replace(BULLET, "").replace(/\s+/g, " ").trim();
const decode = (s) =>
  new DOMParser().parseFromString(String(s), "text/html").documentElement.textContent;
function fillForm(r) {
  if (r.title) $("title").value = r.title;
  if (r.ing && r.ing.length) $("ing").value = r.ing.join("\n");
  if (r.steps && r.steps.length) $("steps").value = r.steps.join("\n");
}
// Headings are often letter-spaced ("I N G R E D I E N T S"), so compare with everything but letters removed.
function headKind(l) {
  if (l.length > 30) return null;
  const c = l.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (/^[il]ngred[il]ents?$/.test(c)) return "ing";
  if (/^(directions?|instructions?|method|steps?|preparation)$/.test(c)) return "steps";
  if (/^(notes?|nutrition|tips?|storage|description|serves|yield)$/.test(c)) return "other";
  return null;
}
const HEAD = { test: (l) => !!headKind(l) };
function tidyOcr(text) {
  const t = text
    .replace(/\ufb01/g, "fi")
    .replace(/\ufb02/g, "fl")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\b[lI|](?=\/\d)/g, "1")
    .replace(/(\d)\s*[lI|](?=\s|$)/g, "$11")
    .replace(/(?<=[a-z])[|¦](?=[a-z])/g, "l")
    .replace(/[|¦]/g, "I");
  const out = [];
  for (const raw of t.split("\n")) {
    const l = raw.replace(/[ \t]+/g, " ").trim();
    if (!l || /^[^\w½¼¾⅓⅔⅛]+$/.test(l) || (!headKind(l) && !/[A-Za-z]{3}/.test(l))) {
      continue;
    }
    const p = out[out.length - 1];
    if (p && /-$/.test(p) && /^[a-z]/.test(l)) out[out.length - 1] = p.slice(0, -1) + l;
    else if (p && /^[a-z(]/.test(l) && !/[.!?:]$/.test(p) && !HEAD.test(p) && !HEAD.test(l))
      out[out.length - 1] = p + " " + l;
    else out.push(l);
  }
  return out;
}
function parseRecipeText(text) {
  const L = tidyOcr(text);
  const kinds = L.map(headKind);
  const i = kinds.indexOf("ing"),
    st = kinds.indexOf("steps");
  let title = "",
    ing = [],
    steps = [];
  if (i >= 0 || st >= 0) {
    const first = kinds.findIndex(Boolean);
    title = L.slice(0, first).find((l) => l.length < 80) || "";
    // A section runs until the next heading of any kind (Notes, Nutrition…).
    const seg = (a) => {
      let e = kinds.findIndex((k, j) => j > a && k);
      if (e < 0) e = L.length;
      return L.slice(a + 1, e);
    };
    if (i >= 0) ing = seg(i);
    if (st >= 0) steps = seg(st);
  } else {
    title = L[0] && L[0].length < 80 ? L[0] : "";
    const body = title ? L.slice(1) : L;
    const qty = /^(?:[-*•·▪]\s*)?(?:\d|[½¼¾⅓⅔⅛]|a\s|an\s|one\s|pinch|dash)/i;
    body.forEach((l) =>
      (qty.test(l) && l.length < 70 && !/^\d+[.)]\s/.test(l) ? ing : steps).push(l),
    );
  }
  if (title && title === title.toUpperCase())
    title = title.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return {
    title: clean(title),
    ing: ing.map(clean).filter(Boolean),
    steps: steps.map(clean).filter(Boolean),
  };
}
function stepsFrom(x) {
  if (!x) return [];
  if (typeof x === "string") return x.split("\n");
  if (Array.isArray(x)) return x.flatMap(stepsFrom);
  if (x.itemListElement) return stepsFrom(x.itemListElement);
  return stepsFrom(x.text || x.name);
}
function findRecipeNode(n) {
  if (!n || typeof n !== "object") return null;
  if (Array.isArray(n)) {
    for (const c of n) {
      const r = findRecipeNode(c);
      if (r) return r;
    }
    return null;
  }
  const t = [].concat(n["@type"] || []);
  if (t.includes("Recipe")) return n;
  return findRecipeNode(n["@graph"]);
}
function recipeFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let j;
    try {
      j = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const n = findRecipeNode(j);
    if (!n) continue;
    let img = n.image;
    if (Array.isArray(img)) img = img[0];
    if (img && img.url) img = img.url;
    return {
      title: decode(n.name || "").trim(),
      ing: []
        .concat(n.recipeIngredient || [])
        .map((x) => clean(decode(x)))
        .filter(Boolean),
      steps: stepsFrom(n.recipeInstructions)
        .map((x) => clean(decode(x)))
        .filter(Boolean),
      image: typeof img === "string" ? img : null,
      rating: Number(n.aggregateRating && n.aggregateRating.ratingValue) || 0,
      votes:
        Number(
          n.aggregateRating && (n.aggregateRating.ratingCount || n.aggregateRating.reviewCount),
        ) || 0,
    };
  }
  return null;
}
// Free CORS proxies come and go, so try several; `json` ones wrap the page in {contents}.
const PROXIES = [
  { u: (u) => u },
  { u: (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u) },
  { u: (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u) },
  { u: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
  { u: (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u), json: true },
  { u: (u) => "https://thingproxy.freeboard.io/fetch/" + u },
];
async function timedFetch(url, ms = 12000) {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}
async function fetchVia(url, kind) {
  for (const p of PROXIES) {
    if (p.json && kind !== "text") continue;
    try {
      const r = await timedFetch(p.u(url));
      if (!r.ok) continue;
      if (p.json) return (await r.json()).contents || "";
      return await r[kind]();
    } catch {}
  }
  throw new Error("Could not fetch that page.");
}
// Drop tracking parameters and fragments so share links (e.g. from Instagram) resolve to the plain page.
function cleanUrl(u) {
  const x = new URL(u);
  x.hash = "";
  [...x.searchParams.keys()]
    .filter((k) => /^(utm_|fbclid|igshid|igsh|gclid|mc_|ref$)/i.test(k))
    .forEach((k) => x.searchParams.delete(k));
  return x.href;
}
// Try every proxy until one returns a page that actually contains recipe data (some return bot-check pages).
async function fetchRecipe(url) {
  let reached = false;
  for (const p of PROXIES) {
    try {
      const r = await timedFetch(p.u(url));
      if (!r.ok) continue;
      const html = p.json ? (await r.json()).contents || "" : await r.text();
      if (!html) continue;
      reached = true;
      const rec = recipeFromHtml(html);
      if (rec && (rec.ing.length || rec.steps.length)) return rec;
    } catch {}
  }
  // Last resort: a reader service that returns the page as plain text, parsed by headings.
  try {
    const r = await timedFetch("https://r.jina.ai/" + url, 20000);
    if (r.ok) {
      const t = await r.text(),
        rec = parseRecipeText(
          t
            .replace(/^(?:Title|URL Source|Markdown Content):.*$/gm, "")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/[*_`]/g, ""),
        );
      const t0 = (t.match(/^Title:\s*(.+)$/m) || [])[1];
      if (t0 && !rec.title) rec.title = clean(t0);
      if (rec.ing.length && rec.steps.length) {
        rec.fromText = true;
        return rec;
      }
      reached = true;
    }
  } catch {}
  return reached ? null : undefined;
}
$("importBtn").onclick = async () => {
  let u = $("url").value.trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    u = cleanUrl(u);
  } catch {
    status("That does not look like a valid link.");
    return;
  }
  const b = $("importBtn");
  b.disabled = true;
  busy("Importing recipe…");
  try {
    const r = await fetchRecipe(u);
    if (r === undefined) {
      status(
        "Could not reach that page — the site may block imports. Try copying the recipe text instead.",
      );
      return;
    }
    if (!r) {
      status("No recipe data found on that page. Try copying the text instead.");
      return;
    }
    fillForm(r);
    await setImage(r.image, u);
    status(
      r.fromText
        ? "Imported from page text — please double-check the ingredients and steps."
        : "Imported — review and save.",
    );
    $("url").value = "";
  } catch (e) {
    status(e.message);
  } finally {
    b.disabled = false;
    busy("");
  }
};
async function setImage(src, base) {
  if (!src || photo) return;
  try {
    photo = await shrink(await fetchVia(new URL(src, base).href, "blob"));
    drop.style.backgroundImage = `url(${photo})`;
    drop.classList.add("has");
    drop.querySelector("span").textContent = "Change photo";
  } catch {}
}
const STOP = new Set([
  "recipe",
  "recipes",
  "best",
  "easy",
  "simple",
  "quick",
  "homemade",
  "the",
  "a",
  "an",
  "of",
  "with",
  "and",
  "for",
  "how",
  "to",
  "make",
  "my",
  "style",
]);
const stem = (w) =>
  w
    .replace(/ies$/, "y")
    .replace(/oes$/, "o")
    .replace(/(ch|sh|x|s|z)es$/, "$1")
    .replace(/([^s])s$/, "$1");
const tokens = (t) =>
  (
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z]+/g) || []
  )
    .filter((w) => !STOP.has(w))
    .map(stem);
// Fraction of query words found in the title, with a bonus when the title contains the whole phrase in order.
function relevance(r, q) {
  const qt = tokens(q);
  if (!qt.length) return 1;
  const tt = tokens(r.title || ""),
    set = new Set(tt);
  let f = qt.filter((w) => set.has(w)).length / qt.length;
  if (tt.join(" ").includes(qt.join(" "))) f += 0.5;
  return f - Math.max(0, tt.length - qt.length - 4) * 0.03;
}
const quality = (r) =>
  (r.rating && r.votes ? r.rating * Math.log10(1 + r.votes) : 0) +
  Math.min(r.ing.length, 12) / 4 +
  Math.min(r.steps.length, 10) / 5 +
  (r.image ? 1 : 0);
const rank = (c, q) =>
  c
    .map((r) => ({ r, rel: relevance(r, q) }))
    .filter((x) => x.rel >= 0.5)
    .sort((a, b) => b.rel * 8 + quality(b.r) - (a.rel * 8 + quality(a.r)))
    .map((x) => x.r);
const mealOf = (m) => {
  const ing = [];
  for (let i = 1; i <= 20; i++) {
    const a = (m["strIngredient" + i] || "").trim(),
      b = (m["strMeasure" + i] || "").trim();
    if (a) ing.push(clean(`${b} ${a}`));
  }
  return {
    title: m.strMeal,
    ing,
    steps: (m.strInstructions || "")
      .split(/\r?\n/)
      .map(clean)
      .filter((x) => x.length > 2 && !/^step\s*\d+$/i.test(x)),
    image: m.strMealThumb,
    source: "TheMealDB",
  };
};
const mealApi = async (path) => {
  try {
    return (
      JSON.parse(await fetchVia("https://www.themealdb.com/api/json/v1/1/" + path, "text")).meals ||
      []
    );
  } catch {
    return [];
  }
};
async function mealDb(q) {
  const t = tokens(q),
    variants = [...new Set([q.trim(), t.join(" "), ...t.filter((w) => w.length > 3)])]
      .filter(Boolean)
      .slice(0, 4);
  const byName = (
    await Promise.all(variants.map((v) => mealApi("search.php?s=" + encodeURIComponent(v))))
  ).flat();
  let meals = byName;
  if (!meals.length) {
    // No name match: look for meals containing the main ingredient, then fetch full details for a few.
    const brief = (
      await Promise.all(t.slice(0, 2).map((w) => mealApi("filter.php?i=" + encodeURIComponent(w))))
    )
      .flat()
      .slice(0, 6);
    meals = (await Promise.all(brief.map((m) => mealApi("lookup.php?i=" + m.idMeal)))).flat();
  }
  const seen = new Set();
  return meals.filter((m) => !seen.has(m.idMeal) && seen.add(m.idMeal)).map(mealOf);
}
async function webSearch(q) {
  const html = await fetchVia(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q + " recipe"),
    "text",
  );
  const urls = [
    ...new DOMParser().parseFromString(html, "text/html").querySelectorAll("a.result__a"),
  ]
    .map((a) => {
      try {
        const h = new URL(a.getAttribute("href"), "https://duckduckgo.com");
        return h.searchParams.get("uddg") || h.href;
      } catch {
        return null;
      }
    })
    .filter((u) => /^https?:/.test(u) && !/duckduckgo\.com/.test(u))
    .slice(0, 8);
  const found = await Promise.all(
    urls.map(async (u) => {
      try {
        const r = recipeFromHtml(await fetchVia(u, "text"));
        if (r) {
          r.base = u;
          r.source = new URL(u).hostname;
        }
        return r;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((r) => r && r.ing.length && r.steps.length);
}
let cands = [],
  ci = 0;
async function applyCandidate(r) {
  if (!photoFile && !editing) {
    photo = null;
    drop.style.backgroundImage = "";
    drop.classList.remove("has");
    drop.querySelector("span").textContent = "📷 Upload a photo";
  }
  fillForm(r);
  await setImage(r.image, r.base || location.href);
  $("nextBtn").hidden = cands.length < 2;
  status(`“${r.title}” from ${r.source} (${ci + 1} of ${cands.length}) — review and save.`);
}
$("searchBtn").onclick = async () => {
  const q = $("q").value.trim();
  if (!q) return;
  const b = $("searchBtn");
  b.disabled = true;
  $("nextBtn").hidden = true;
  status("");
  busy(`Searching for the best “${q}” recipe…`);
  try {
    // Query both sources together so a weak match in one doesn't hide a better one in the other.
    const [m, w] = await Promise.all([mealDb(q).catch(() => []), webSearch(q).catch(() => [])]);
    cands = rank(
      [...m, ...w].filter((r) => r.ing.length && r.steps.length),
      q,
    );
    ci = 0;
    if (!cands.length) {
      status(`No recipe found for “${q}”. Try a different name or paste a link.`);
      return;
    }
    await applyCandidate(cands[0]);
    $("q").value = "";
  } catch (e) {
    status(e.message);
  } finally {
    b.disabled = false;
    busy("");
  }
};
$("nextBtn").onclick = async () => {
  if (cands.length < 2) return;
  ci = (ci + 1) % cands.length;
  const b = $("nextBtn");
  b.disabled = true;
  try {
    await applyCandidate(cands[ci]);
  } finally {
    b.disabled = false;
  }
};
$("q").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("searchBtn").click();
  }
};
$("url").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("importBtn").click();
  }
};
let tessLoad;
const loadTesseract = () =>
  tessLoad ||
  (tessLoad = new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = () => res(window.Tesseract);
    s.onerror = () => {
      tessLoad = null;
      rej(new Error("Could not load the text reader (offline?)."));
    };
    document.head.appendChild(s);
  }));
async function loadBitmap(src) {
  if (typeof src === "string") {
    return await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  }
  try {
    return await createImageBitmap(src, { imageOrientation: "from-image" });
  } catch {
    return await new Promise((res, rej) => {
      const u = URL.createObjectURL(src),
        i = new Image();
      i.onload = () => {
        URL.revokeObjectURL(u);
        res(i);
      };
      i.onerror = rej;
      i.src = u;
    });
  }
}
// Upscale small images, grayscale, then binarize against a local average so uneven lighting and shadows don't swallow text.
async function preprocess(src) {
  const img = await loadBitmap(src),
    w0 = img.width,
    h0 = img.height;
  const sc = Math.min(2.5, Math.max(0.5, 2200 / Math.max(w0, h0)));
  const w = Math.round(w0 * sc),
    h = Math.round(h0 * sc);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, w, h);
  x.imageSmoothingQuality = "high";
  x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h),
    d = id.data,
    g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++)
    g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const W = w + 1,
    I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let xx = 0; xx < w; xx++) {
      row += g[y * w + xx];
      I[(y + 1) * W + xx + 1] = I[y * W + xx + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 40));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r),
      y1 = Math.min(h, y + r + 1);
    for (let xx = 0; xx < w; xx++) {
      const x0 = Math.max(0, xx - r),
        x1 = Math.min(w, xx + r + 1);
      const sum = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const m = sum / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + xx] < m * 0.88 ? 0 : 255,
        i = (y * w + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}
// Drop low-confidence words (photos, decoration) and stray fragments after a wide gap on the same line.
function ocrLines(data) {
  if (!data.lines || !data.lines.length) return data.text || "";
  return data.lines
    .map((l) => {
      const ws = (l.words || []).filter(
        (w) => w.confidence >= 65 && /[A-Za-z0-9½¼¾⅓⅔⅛]/.test(w.text),
      );
      const h = l.bbox.y1 - l.bbox.y0,
        kept = [];
      for (let k = 0; k < ws.length; k++) {
        const p = kept[kept.length - 1];
        if (p && ws[k].bbox.x0 - p.bbox.x1 > h * 2.5) {
          const rest = ws.slice(k);
          if (rest.length < 3 || rest.reduce((a, w) => a + w.confidence, 0) / rest.length < 80)
            break;
        }
        kept.push(ws[k]);
      }
      return kept.map((w) => w.text).join(" ");
    })
    .join("\n");
}
async function recognize(T, canvas) {
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") busy(`Reading image… ${Math.round(m.progress * 100)}%`);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" });
    let best = null;
    // Auto layout first (handles columns); fall back to a single uniform block if confidence is poor.
    for (const psm of ["3", "6"]) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(canvas);
      if (!best || data.confidence > best.confidence) best = data;
      if (best.confidence >= 75) break;
    }
    return best;
  } finally {
    await worker.terminate();
  }
}
$("scanBtn").onclick = async () => {
  const src = photoFile || photo;
  if (!src) return;
  const b = $("scanBtn");
  b.disabled = true;
  status("");
  busy("Reading image…");
  try {
    const T = await loadTesseract();
    busy("Reading image…");
    const data = await recognize(T, await preprocess(src));
    const r = parseRecipeText(ocrLines(data));
    if (!r.ing.length && !r.steps.length && !r.title) {
      status("No text found in that photo.");
      return;
    }
    fillForm(r);
    status("Text read from photo — check for mistakes and save.");
  } catch (e) {
    status(e.message || "Could not read the photo.");
  } finally {
    b.disabled = false;
    busy("");
  }
};
function card(r) {
  const d = document.createElement("article");
  d.className = "card";
  d.dataset.id = r.id;
  d.innerHTML =
    '<div class="hero"></div><div class="body"><div class="head"><h2></h2><button class="edit editonly" aria-label="Edit recipe">✎</button><button class="del editonly" aria-label="Delete recipe">×</button></div><button class="toggle">View recipe</button><div class="detail"><div><h3>Ingredients</h3><ul></ul><h3>Steps</h3><ol></ol></div></div></div>';
  const hero = d.querySelector(".hero");
  if (r.photo) hero.style.backgroundImage = `url(${r.photo})`;
  else hero.textContent = r.emoji || "🍽️";
  d.querySelector("h2").textContent = r.title;
  const fill = (sel, a) =>
    a.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      d.querySelector(sel).appendChild(li);
    });
  fill("ul", r.ing);
  fill("ol", r.steps);
  return d;
}
function markDot() {
  const l = $("list"),
    i = Math.round(l.scrollLeft / (l.clientWidth + 12));
  [...$("dots").children].forEach((b, j) => b.classList.toggle("on", j === i));
}
$("list").addEventListener("scroll", markDot, { passive: true });
function render() {
  const l = $("list");
  l.innerHTML = "";
  if (!recipes.length) l.innerHTML = '<div class="empty">No recipes yet.</div>';
  recipes.forEach((r) => l.appendChild(card(r)));
  const dots = $("dots");
  dots.innerHTML = "";
  if (recipes.length > 1)
    recipes.forEach((r, i) => {
      const b = document.createElement("button");
      b.setAttribute("aria-label", "Recipe " + (i + 1) + ": " + r.title);
      b.onclick = () => l.scrollTo({ left: i * (l.clientWidth + 12), behavior: "smooth" });
      dots.appendChild(b);
    });
  markDot();
  $("count").textContent = `${recipes.length} saved recipe${recipes.length === 1 ? "" : "s"}`;
}
let editing = null;
function setFormOpen(open) {
  showPage(
    open ? "add" : "recipes",
    document.querySelector(
      open ? '.tabs button[data-action="add"]' : '.tabs button[data-tab="recipes"]',
    ),
  );
}
function resetForm() {
  editing = null;
  $("form").reset();
  setFormOpen(false);
  $("addTitle").textContent = "Add recipe";
  photo = null;
  drop.style.backgroundImage = "";
  drop.classList.remove("has");
  drop.querySelector("span").textContent = "📷 Upload a photo";
  photoFile = null;
  $("scanBtn").hidden = true;
  $("nextBtn").hidden = true;
  cands = [];
  status("");
  $("saveBtn").textContent = "Save recipe";
  $("cancelEdit").hidden = true;
}
$("form").onsubmit = (e) => {
  e.preventDefault();
  const data = {
    title: $("title").value.trim(),
    ing: lines($("ing").value),
    steps: lines($("steps").value),
    photo,
  };
  const before = recipes.slice();
  if (editing) {
    recipes = recipes.map((r) => (r.id == editing ? { ...r, ...data } : r));
  } else recipes.unshift({ id: Date.now(), ...data });
  if (!save()) {
    recipes = before;
    return;
  }
  resetForm();
  render();
};
$("cancelEdit").onclick = resetForm;
function confirmDelete(title) {
  const d = $("confirmDlg");
  $("confirmMsg").textContent = `“${title}” will be removed from your recipes and meal plan.`;
  return new Promise((res) => {
    d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true });
    d.returnValue = "cancel";
    d.showModal();
  });
}
$("list").addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  if (e.target.closest(".edit,.del") === null && !e.target.closest("a,input,select,textarea")) {
    const o = c.classList.toggle("open");
    c.querySelector(".toggle").textContent = o ? "Hide recipe" : "View recipe";
  } else if (e.target.classList.contains("edit")) {
    const r = recipes.find((x) => x.id == c.dataset.id);
    editing = r.id;
    setFormOpen(true);
    $("addTitle").textContent = "Edit recipe";
    photo = r.photo || null;
    photoFile = null;
    $("scanBtn").hidden = !photo;
    $("title").value = r.title;
    $("ing").value = r.ing.join("\n");
    $("steps").value = r.steps.join("\n");
    drop.style.backgroundImage = photo ? `url(${photo})` : "";
    drop.classList.toggle("has", !!photo);
    drop.querySelector("span").textContent = photo ? "Change photo" : "📷 Upload a photo";
    $("saveBtn").textContent = "Update recipe";
    $("cancelEdit").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (e.target.classList.contains("del")) {
    const rec = recipes.find((r) => r.id == c.dataset.id);
    confirmDelete(rec ? rec.title : "this recipe").then((ok) => {
      if (!ok) return;
      if (editing == c.dataset.id) resetForm();
      recipes = recipes.filter((r) => r.id != c.dataset.id);
      for (const k in plan) {
        plan[k] = plan[k].filter((e) => e.id != c.dataset.id);
        if (!plan[k].length) delete plan[k];
      }
      save();
      savePlan();
      c.classList.add("out");
      setTimeout(render, 250);
    });
  }
});
render();

/* Calendar / meal plan */
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
let plan;
if (!REMOTE)
  try {
    plan = JSON.parse(localStorage.getItem(PKEY));
  } catch {}
if (REMOTE) plan = {};
const SLOTS = [
  ["breakfast", "Breakfast"],
  ["snack1", "Morning snack"],
  ["lunch", "Lunch"],
  ["snack2", "Afternoon snack"],
  ["dinner", "Dinner"],
];
// Older plans stored bare recipe ids per day; treat those as dinner.
function normPlan(p) {
  const out = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  for (const k in p) {
    if (!Array.isArray(p[k])) continue;
    const a = p[k].map((x) =>
      x && typeof x === "object"
        ? { id: x.id, slot: SLOTS.some((s) => s[0] === x.slot) ? x.slot : "dinner" }
        : { id: x, slot: "dinner" },
    );
    if (a.length) out[k] = a;
  }
  return out;
}
if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
  const t = new Date(today);
  t.setDate(t.getDate() + 1);
  plan = {
    [ymd(today)]: [{ id: 1, slot: "dinner" }],
    [ymd(t)]: [
      { id: 2, slot: "breakfast" },
      { id: 3, slot: "lunch" },
    ],
  };
  savePlan();
} else plan = normPlan(plan);
function savePlan() {
  if (REMOTE) {
    if (!signedInUser) {
      alert("Sign in from the Account tab to edit the shared meal plan.");
      return false;
    }
    fs.setDoc(fs.doc(db, "meta", "plan"), { json: JSON.stringify(plan) }).catch(fail);
    return true;
  }
  try {
    localStorage.setItem(PKEY, JSON.stringify(plan));
  } catch {}
  return true;
}
let sel = ymd(today),
  calMode = localStorage.getItem("cookcal-calview");
if (!["day", "week", "month"].includes(calMode)) calMode = "month";
const byId = (id) => recipes.find((r) => r.id == id);
const fromYmd = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
function shiftSel(dir) {
  const c = fromYmd(sel);
  if (calMode === "month") {
    const n = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    n.setDate(Math.min(c.getDate(), new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
    sel = ymd(n);
  } else
    sel = ymd(
      new Date(c.getFullYear(), c.getMonth(), c.getDate() + dir * (calMode === "week" ? 7 : 1)),
    );
}
function renderCal() {
  const c = fromYmd(sel),
    g = $("grid"),
    wk = $("week");
  document
    .querySelectorAll("#calMode button")
    .forEach((b) => b.classList.toggle("on", b.dataset.mode === calMode));
  g.hidden = calMode !== "month";
  wk.hidden = calMode !== "week";
  const unit = { day: "day", week: "week", month: "month" }[calMode];
  $("prev").setAttribute("aria-label", "Previous " + unit);
  $("next").setAttribute("aria-label", "Next " + unit);
  if (calMode === "month") {
    $("month").textContent = c.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    g.innerHTML = "";
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    first.setDate(1 - ((first.getDay() + 6) % 7));
    ["M", "T", "W", "T", "F", "S", "S"].forEach((d) => {
      const e = document.createElement("div");
      e.className = "dow";
      e.textContent = d;
      g.appendChild(e);
    });
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      const k = ymd(d),
        b = document.createElement("button");
      b.className =
        "day" +
        (d.getMonth() !== c.getMonth() ? " other" : "") +
        (k === ymd(today) ? " today" : "") +
        (k === sel ? " sel" : "");
      b.dataset.date = k;
      b.textContent = d.getDate();
      const n = (plan[k] || []).filter((e) => byId(e.id)).length;
      if (n) {
        const dots = document.createElement("i");
        dots.innerHTML = "<b></b>".repeat(Math.min(n, 3));
        b.appendChild(dots);
      }
      g.appendChild(b);
    }
  } else if (calMode === "week") {
    const mon = new Date(c.getFullYear(), c.getMonth(), c.getDate() - ((c.getDay() + 6) % 7)),
      end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    $("month").textContent = `${f(mon)} – ${f(end)}`;
    wk.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i),
        k = ymd(d);
      const b = document.createElement("button");
      b.className = "wrow" + (k === sel ? " sel" : "") + (k === ymd(today) ? " today" : "");
      b.dataset.date = k;
      const wd = document.createElement("div");
      wd.className = "wd";
      wd.append(d.toLocaleDateString(undefined, { weekday: "short" }));
      const num = document.createElement("b");
      num.textContent = d.getDate();
      wd.appendChild(num);
      const wm = document.createElement("div");
      wm.className = "wm";
      const items = (plan[k] || []).filter((e) => byId(e.id));
      SLOTS.forEach(([key, label]) =>
        items
          .filter((e) => e.slot === key)
          .forEach((e) => {
            const row = document.createElement("div");
            const sm = document.createElement("small");
            sm.textContent = label + " · ";
            row.append(sm, byId(e.id).title);
            wm.appendChild(row);
          }),
      );
      if (!items.length) {
        const em = document.createElement("em");
        em.textContent = "Nothing planned";
        wm.appendChild(em);
      }
      b.append(wd, wm);
      wk.appendChild(b);
    }
  } else {
    $("month").textContent = c.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  renderDay();
}
function renderDay() {
  const [y, m, d] = sel.split("-").map(Number);
  $("selTitle").textContent = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const list = $("meals");
  list.innerHTML = "";
  const entries = (plan[sel] || []).map((e, i) => ({ ...e, i })).filter((e) => byId(e.id));
  SLOTS.forEach(([key, label]) => {
    const sec = document.createElement("div");
    sec.className = "slot";
    const h = document.createElement("h3");
    h.textContent = label;
    sec.appendChild(h);
    entries
      .filter((e) => e.slot === key)
      .forEach((e) => {
        const r = byId(e.id),
          m = document.createElement("div");
        m.className = "meal";
        m.dataset.idx = e.i;
        m.innerHTML =
          '<div class="th"></div><span></span><button class="del editonly" aria-label="Remove from day">×</button>';
        const th = m.querySelector(".th");
        if (r.photo) th.style.backgroundImage = `url(${r.photo})`;
        else th.textContent = r.emoji || "🍽️";
        m.querySelector("span").textContent = r.title;
        sec.appendChild(m);
      });
    if (recipes.length) {
      const sl = document.createElement("select");
      sl.className = "add editonly";
      sl.dataset.slot = key;
      sl.setAttribute("aria-label", "Add recipe to " + label.toLowerCase());
      sl.innerHTML = '<option value="">＋ Add a recipe…</option>';
      recipes.forEach((r) => {
        const o = document.createElement("option");
        o.value = r.id;
        o.textContent = r.title;
        sl.appendChild(o);
      });
      sec.appendChild(sl);
    } else if (!entries.some((e) => e.slot === key)) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Nothing planned.";
      sec.appendChild(hint);
    }
    list.appendChild(sec);
  });
}
$("grid").addEventListener("click", (e) => {
  const b = e.target.closest(".day");
  if (!b) return;
  sel = b.dataset.date;
  renderCal();
});
$("week").addEventListener("click", (e) => {
  const b = e.target.closest(".wrow");
  if (!b) return;
  sel = b.dataset.date;
  renderCal();
});
$("prev").onclick = () => {
  shiftSel(-1);
  renderCal();
};
$("next").onclick = () => {
  shiftSel(1);
  renderCal();
};
$("calMode").addEventListener("click", (e) => {
  const m = e.target.dataset.mode;
  if (!m) return;
  calMode = m;
  try {
    localStorage.setItem("cookcal-calview", m);
  } catch {}
  renderCal();
});
$("meals").addEventListener("change", (e) => {
  const sl = e.target.closest("select.add");
  if (!sl || !sl.value) return;
  (plan[sel] = plan[sel] || []).push({ id: sl.value, slot: sl.dataset.slot });
  savePlan();
  renderCal();
});
$("meals").addEventListener("click", (e) => {
  if (!e.target.classList.contains("del")) return;
  const idx = Number(e.target.closest(".meal").dataset.idx);
  plan[sel].splice(idx, 1);
  if (!plan[sel].length) delete plan[sel];
  savePlan();
  renderCal();
});
function showPage(t, button) {
  document.querySelectorAll(".tabs button").forEach((b) => {
    const active = b === button;
    b.classList.toggle("on", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("recipesView").hidden = t !== "recipes";
  $("addView").hidden = t !== "add";
  $("shopView").hidden = t !== "shop";
  $("accountView").hidden = t !== "account";
  if (t === "account" && signedInUser) renderCal();
  if (t === "shop") renderShop();
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  let button = e.target.closest("button[data-tab], button[data-action]");
  if (!button) return;
  if (button.dataset.action === "add") {
    if (REMOTE && !signedInUser) {
      button = document.querySelector('.tabs button[data-tab="account"]');
      showPage("account", button);
      return;
    }
    resetForm();
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  showPage(button.dataset.tab, button);
});

/* Account / shared edit access */
let authMode = "login";
function authMessage(message, isError = false) {
  const status = $("accountStatus");
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function setAuthMode(mode) {
  authMode = mode;
  $("authSubmit").textContent = mode === "signup" ? "Create account" : "Log in";
  $("authToggle").textContent = mode === "signup" ? "Back to log in" : "Create account";
  $("authPassword").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("resetPassword").hidden = mode === "signup";
}
$("authToggle").onclick = () => setAuthMode(authMode === "login" ? "signup" : "login");
$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!REMOTE) return authMessage("Sign-in is available when Firebase is configured.", true);
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  $("authSubmit").disabled = true;
  try {
    if (authMode === "signup") await authApi.createUserWithEmailAndPassword(auth, email, password);
    else await authApi.signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const messages = {
      "auth/email-already-in-use": "An account already uses that email. Try logging in.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/weak-password": "Choose a stronger password (at least 6 characters).",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/too-many-requests": "Too many attempts. Try again later.",
    };
    authMessage(messages[e.code] || e.message, true);
  } finally {
    $("authSubmit").disabled = false;
  }
});
$("resetPassword").onclick = async () => {
  if (!REMOTE) return authMessage("Sign-in is available when Firebase is configured.", true);
  const email = $("authEmail").value.trim();
  if (!email) {
    $("authEmail").focus();
    return authMessage("Enter your email address first.", true);
  }
  try {
    await authApi.sendPasswordResetEmail(auth, email);
    authMessage("If an account exists for that email, a password reset link has been sent.");
  } catch (e) {
    authMessage(e.message, true);
  }
};
$("signOut").onclick = () => authApi.signOut(auth).catch((e) => authMessage(e.message, true));
if (REMOTE) {
  $("authForm").hidden = false;
  authApi.onAuthStateChanged(auth, (user) => {
    signedInUser = user;
    document.documentElement.dataset.auth = user ? "in" : "out";
    $("authForm").hidden = !!user;
    $("signOut").hidden = !user;
    $("planView").hidden = !user;
    if (user)
      authMessage(
        `Signed in as ${user.email || "your account"}. You can edit shared recipes and meal plans.`,
      );
    else authMessage("Sign in to add or edit shared recipes and meal plans.");
  });
} else {
  $("authForm").hidden = true;
  $("authToggle").hidden = true;
  $("resetPassword").hidden = true;
  authMessage("Accounts are unavailable in local mode.");
}

/* Weekly grocery list (Monday–Sunday) */
const GKEY = "cookcal-groceries-v1";
let checked;
try {
  checked = JSON.parse(localStorage.getItem(GKEY));
} catch {}
if (!checked || typeof checked !== "object" || Array.isArray(checked)) checked = {};
const monday = (d) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
let week = monday(today);
const FR = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const UNITS = {
  tsp: ["v", 4.93, "tsp"],
  teaspoon: ["v", 4.93, "tsp"],
  tbsp: ["v", 14.79, "tbsp"],
  tablespoon: ["v", 14.79, "tbsp"],
  cup: ["v", 236.6, "cup"],
  ml: ["v", 1, "ml"],
  l: ["v", 1000, "l"],
  liter: ["v", 1000, "l"],
  litre: ["v", 1000, "l"],
  g: ["m", 1, "g"],
  gram: ["m", 1, "g"],
  kg: ["m", 1000, "kg"],
  oz: ["m", 28.35, "oz"],
  ounce: ["m", 28.35, "oz"],
  lb: ["m", 453.6, "lb"],
  pound: ["m", 453.6, "lb"],
};
const UNIT_RE = new RegExp(
  "^(" +
    [
      ...Object.keys(UNITS),
      "clove",
      "can",
      "slice",
      "pinch",
      "bunch",
      "stick",
      "pkg",
      "package",
      "piece",
      "sprig",
      "head",
    ].join("|") +
    ")s?\\b\\.?\\s*(?:of\\s+)?",
  "i",
);
const DESC =
  /\b(large|medium|small|fresh|freshly|chopped|minced|diced|sliced|whole|ripe|extra|boneless|skinless|finely|roughly|grated|shredded|peeled|crushed|packed|yolks?|whites?|optional)\b/g;
function singular(w) {
  return w
    .replace(/ies$/, "y")
    .replace(/(o|ch|sh|x)es$/, "$1")
    .replace(/([^su])s$/, "$1");
}
// Splits "3 large eggs" into qty/unit/name; returns null when there is no leading quantity.
function parseIng(t) {
  const m = t
    .trim()
    .match(
      /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])\s*(?:-\s*\d[\d./]*\s*)?(.*)$/,
    );
  if (!m) return null;
  let q = m[1].trim(),
    qty;
  if (/^\d+\s+\d+\/\d+$/.test(q)) {
    const [w, f] = q.split(/\s+/),
      [n, d] = f.split("/");
    qty = +w + n / d;
  } else if (/^\d+\/\d+$/.test(q)) {
    const [n, d] = q.split("/");
    qty = n / d;
  } else {
    qty = 0;
    for (const c of q) qty += FR[c] || 0;
    const num = q.replace(/[½¼¾⅓⅔⅛]/g, "").trim();
    if (num) qty += parseFloat(num);
  }
  if (!(qty > 0)) return null;
  let rest = m[2]
      .replace(/\([^)]*\)/g, " ")
      .replace(/,.*$/, "")
      .trim(),
    unit = "",
    fam = "n",
    f = 1,
    disp = "";
  const um = rest.match(UNIT_RE);
  if (um) {
    const u = um[1].toLowerCase(),
      def = UNITS[u];
    if (def) {
      fam = def[0];
      f = def[1];
      disp = def[2];
    } else {
      fam = "u:" + u;
      disp = u;
    }
    rest = rest.slice(um[0].length);
  }
  const name = rest
    .toLowerCase()
    .replace(DESC, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i, a) => (i === a.length - 1 ? singular(w) : w))
    .join(" ");
  if (!name) return null;
  const tm = fam === "n" && name.match(/^(.+) (clove|slice|sprig|stick)$/);
  if (tm) return { qty, fam: "u:" + tm[2], disp: tm[2], name: tm[1] };
  return { qty: qty * f, fam, disp, name };
}
const fmtN = (n) => {
  const r = Math.round(n * 4) / 4,
    w = Math.floor(r),
    fr = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[r - w] || "";
  return n < 10 && !Number.isInteger(r)
    ? (w || "") + fr || String(+n.toFixed(1))
    : String(+n.toFixed(n < 10 ? 1 : 0));
};
const plural = (n, w) =>
  n > 1
    ? /[^aeiou]y$/.test(w)
      ? w.slice(0, -1) + "ies"
      : /(o|ch|sh|x)$/.test(w)
        ? w + "es"
        : w + "s"
    : w;
function fmtItem(it) {
  let q = it.base,
    u = "";
  if (it.fam === "v") {
    const metric = /^(ml|l)$/.test(it.disp);
    if (metric) {
      u = q >= 1000 ? ((q /= 1000), "l") : "ml";
    } else if (q >= 236.6 / 4) {
      q /= 236.6;
      u = "cup";
    } else if (q >= 14.79) {
      q /= 14.79;
      u = "tbsp";
    } else {
      q /= 4.93;
      u = "tsp";
    }
  } else if (it.fam === "m") {
    const metric = /^k?g$/.test(it.disp);
    if (metric) {
      u = q >= 1000 ? ((q /= 1000), "kg") : "g";
    } else if (q >= 453.6) {
      q /= 453.6;
      u = "lb";
    } else {
      q /= 28.35;
      u = "oz";
    }
  } else if (it.fam !== "n") {
    u = it.disp;
  }
  const unitTxt = u
    ? ([
        "cup",
        "clove",
        "can",
        "slice",
        "bunch",
        "stick",
        "piece",
        "sprig",
        "head",
        "package",
        "pkg",
      ].includes(u)
        ? plural(q, u)
        : u) + " "
    : "";
  return `${fmtN(q)} ${unitTxt}${it.fam === "n" ? plural(q, it.name) : it.name}`;
}
function renderShop() {
  const end = new Date(week);
  end.setDate(end.getDate() + 6);
  const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  $("weekTitle").textContent = `${f(week)} – ${f(end)}`;
  const wk = ymd(week),
    items = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(week);
    d.setDate(d.getDate() + i);
    (plan[ymd(d)] || []).forEach((e) => {
      const r = byId(e.id);
      if (!r) return;
      r.ing.forEach((t) => {
        const p = parseIng(t),
          k = p ? p.name + "|" + p.fam : t.toLowerCase().replace(/\s+/g, " ").trim();
        const it = items.get(k) || { text: t, n: 0, from: new Set(), base: 0 };
        if (p) {
          it.base += p.qty;
          it.fam = p.fam;
          it.name = p.name;
          it.disp = it.disp || p.disp;
          it.text = fmtItem(it);
          it.parsed = true;
        } else it.n++;
        it.from.add(r.title);
        items.set(k, it);
      });
    });
  }
  const box = $("groList");
  box.innerHTML = "";
  if (!items.size) {
    box.innerHTML =
      '<div class="hint shop-empty-hint">No recipes planned this week. Add some in the Calendar tab.</div>';
    return;
  }
  [...items]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, it]) => {
      const key = wk + "|" + k,
        l = document.createElement("label");
      l.className = "gi";
      l.innerHTML = '<input type="checkbox"><span></span><em></em>';
      const cb = l.querySelector("input");
      cb.checked = !!checked[key];
      l.querySelector("span").textContent = it.text;
      l.querySelector("em").textContent = !it.parsed && it.n > 1 ? `×${it.n}` : "";
      l.title = "For: " + [...it.from].join(", ");
      cb.onchange = () => {
        if (cb.checked) checked[key] = 1;
        else delete checked[key];
        try {
          localStorage.setItem(GKEY, JSON.stringify(checked));
        } catch {}
      };
      box.appendChild(l);
    });
}
$("wprev").onclick = () => {
  week.setDate(week.getDate() - 7);
  renderShop();
};
$("wnext").onclick = () => {
  week.setDate(week.getDate() + 7);
  renderShop();
};
/* Live sync (Firebase mode only) */
function refresh() {
  render();
  renderCal();
  renderShop();
}
if (REMOTE) {
  fs.onSnapshot(
    fs.collection(db, "recipes"),
    (snap) => {
      recipes = snap.docs.map((d) => d.data()).sort((a, b) => Number(b.id) - Number(a.id));
      remoteSnap = new Map(recipes.map((r) => [String(r.id), JSON.stringify(norm(r))]));
      refresh();
    },
    fail,
  );
  fs.onSnapshot(
    fs.doc(db, "meta", "plan"),
    (d) => {
      try {
        plan = normPlan(d.exists() ? JSON.parse(d.data().json) : {});
      } catch {
        plan = {};
      }
      refresh();
    },
    fail,
  );
}
