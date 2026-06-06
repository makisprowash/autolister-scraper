const express = require("express");
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "AutoLister Scraper running" });
});

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  let browser;
  try {
    const puppeteer = require("puppeteer");
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    const vehicle = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const getMeta = (n) => document.querySelector(`meta[property="${n}"]`)?.content || document.querySelector(`meta[name="${n}"]`)?.content || "";
      const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      const vin = vinMatch ? vinMatch[1] : "";
      const priceMatch = html.match(/\$\s*([\d,]{4,7})/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : 0;
      const mileMatch = html.match(/([\d,]+)\s*(?:miles?|mi\.?)/i);
      const mileage = mileMatch ? parseInt(mileMatch[1].replace(/,/g, "")) : 0;
      const title = document.title || getMeta("og:title") || "";
      const ymMatch = title.match(/(\d{4})\s+([A-Za-z\-]+)\s+([\w\s]+)/);
      const year = ymMatch ? parseInt(ymMatch[1]) : 0;
      const make = ymMatch ? ymMatch[2] : "";
      const model = ymMatch ? ymMatch[3].split(/\s+/).slice(0, 2).join(" ").trim() : "";
      const description = getMeta("og:description") || getMeta("description") || "";
      const ogImage = getMeta("og:image");
      const imgs = Array.from(document.querySelectorAll("img"))
        .map(i => i.src || i.getAttribute("data-src") || "")
        .filter(s => s.startsWith("http") && !s.includes("logo") && !s.includes("icon") && s.match(/\.(jpg|jpeg|png|webp)(\?|$)/i));
      const photos = [...new Set([...(ogImage ? [ogImage] : []), ...imgs])].slice(0, 20);
      const featureEls = document.querySelectorAll('[class*="feature"] li, [class*="option"] li, [class*="equipment"] li');
      const features = Array.from(featureEls).map(el => el.textContent.trim()).filter(f => f.length > 2 && f.length < 60).slice(0, 20);
      const stockMatch = html.match(/stock\s*(?:#|number)?:?\s*([A-Z0-9]{4,12})/i);
      const stockNumber = stockMatch ? stockMatch[1] : "";
      return { vin, year, make, model, trim: "", extColor: "", intColor: "", mileage, price, stockNumber, features, description, photos };
    });

    await browser.close();
    res.json(vehicle);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error("Scrape error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AutoLister Scraper running on port ${PORT}`);
});
