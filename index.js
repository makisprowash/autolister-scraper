const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.options("*", cors());
app.use(express.json());

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
      const getMeta = (n) =>
        document.querySelector(`meta[property="${n}"]`)?.content ||
        document.querySelector(`meta[name="${n}"]`)?.content || "";
      const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      const vin = vinMatch ? vinMatch[1] : "";
      // Try DOM selectors first (Dealer.com platform)
      const priceEl = document.querySelector('.price-value, [class*="final-price"] .price-value, .final-price, [data-style-editor-id*="price-value"]');
      let price = 0;
      if (priceEl) {
        price = parseInt(priceEl.textContent.replace(/[^0-9]/g, "")) || 0;
      }
      if (!price) {
        const priceMatch = html.match(/\$\s*([\d,]{4,7})/);
        price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : 0;
      }
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
      const extMatch = html.match(/exterior[^:]*:([^\n<,]{3,40})/i);
      const intMatch = html.match(/interior[^:]*:([^\n<,]{3,40})/i);
      const extColor = extMatch ? extMatch[1].trim() : "";
      const intColor = intMatch ? intMatch[1].trim() : "";
      return { vin, year, make, model, trim: "", extColor, intColor, mileage, price, stockNumber, features, description, photos };
    });
    await browser.close();
    res.json(vehicle);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error("Scrape error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", async (req, res) => {
  const { vehicle } = req.body;
  if (!vehicle) return res.status(400).json({ error: "vehicle required" });
  const feats = Array.isArray(vehicle.features) ? vehicle.features.join(", ") : (vehicle.features || "");
  const name = vehicle.title || `${vehicle.year||""} ${vehicle.make||""} ${vehicle.model||""} ${vehicle.trim||""}`.trim();
  const prompt = `You are Postify AI, expert listing copywriter for Facebook Marketplace at Folsom Lake CDJR in Folsom, CA.

Item: ${name}
Price: $${Number(vehicle.price||0).toLocaleString()}
Details: ${feats||"N/A"}
VIN: ${vehicle.vin||"N/A"} | Stock: ${vehicle.stockNumber||"N/A"}
Mileage: ${vehicle.mileage ? Number(vehicle.mileage).toLocaleString()+" miles" : "N/A"}
Exterior: ${vehicle.extColor||"N/A"} | Interior: ${vehicle.intColor||"N/A"}
Notes: ${vehicle.description||""}

Return ONLY valid JSON, no markdown, no explanation:
{"title":"FB Marketplace title max 100 chars, no emojis","description":"3 paragraphs. Para 1: vehicle appeal. Para 2: key features. Para 3: why buy from Folsom Lake CDJR NorCal.","highlights":["5-7 bullets each starting with a power word like Loaded/One-Owner/Low-Miles"],"financing":"2-3 sentences. Flexible financing, all credit welcome. No specific APR.","cta":"2 sentences. Urgency + contact. Mention Folsom Lake CDJR.","seoTitle":"SEO variant with Folsom CA or NorCal"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
       model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "Claude API error");
    const text = data.content?.map(b => b.text || "").join("") || "";
    const content = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(content);
  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AutoLister Scraper running on port ${PORT}`);
});
