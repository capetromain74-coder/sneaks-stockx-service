const express = require("express");
const SneaksAPI = require("sneaks-api");

const app = express();
const sneaks = new SneaksAPI();
const PORT = process.env.PORT || 4000;

// Cache simple en mémoire (TTL 10 min)
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// GET /search?query=SKU&limit=5
app.get("/search", (req, res) => {
  const query = req.query.query;
  const limit = parseInt(req.query.limit) || 5;

  if (!query) {
    return res.status(400).json({ error: "Le paramètre 'query' est requis" });
  }

  const cacheKey = `search:${query}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  sneaks.getProducts(query, limit, (err, products) => {
    if (err) {
      console.error("Erreur getProducts:", err);
      return res.status(500).json({ error: "Échec de la recherche", details: String(err) });
    }

    const results = (products || []).map((p) => ({
      name: p.shoeName,
      brand: p.brand,
      sku: p.styleID,
      colorway: p.colorway,
      retail_price: p.retailPrice,
      release_date: p.releaseDate,
      thumbnail: p.thumbnail,
      stockx_id: p.resellLinks?.stockX || null,
      goat_id: p.resellLinks?.goat || null,
    }));

    setCache(cacheKey, results);
    res.json(results);
  });
});

// GET /prices?sku=DZ5485-612
app.get("/prices", (req, res) => {
  const sku = req.query.sku;

  if (!sku) {
    return res.status(400).json({ error: "Le paramètre 'sku' est requis" });
  }

  const cacheKey = `prices:${sku}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  sneaks.getProducts(sku, 3, (err, products) => {
    if (err || !products || products.length === 0) {
      return res.status(404).json({ error: "Produit non trouvé", sku });
    }

    const product =
      products.find((p) => p.styleID?.toUpperCase() === sku.toUpperCase()) ||
      products[0];

    sneaks.getProductPrices(product, (err2, productWithPrices) => {
      if (err2) {
        console.error("Erreur getProductPrices:", err2);
        return res.status(500).json({ error: "Échec récupération des prix", details: String(err2) });
      }

      const result = {
        name: productWithPrices.shoeName,
        brand: productWithPrices.brand,
        sku: productWithPrices.styleID,
        colorway: productWithPrices.colorway,
        retail_price: productWithPrices.retailPrice,
        thumbnail: productWithPrices.thumbnail,
        resell_links: productWithPrices.resellLinks || {},
        lowest_asks: {
          stockx: productWithPrices.lowestResellPrice?.stockX || null,
          goat: productWithPrices.lowestResellPrice?.goat || null,
          flight_club: productWithPrices.lowestResellPrice?.flightClub || null,
        },
        prices_by_size: formatPricesBySize(productWithPrices),
      };

      setCache(cacheKey, result);
      res.json(result);
    });
  });
});

function formatPricesBySize(product) {
  const sizes = {};
  if (product.resellPrices) {
    for (const [platform, pricemap] of Object.entries(product.resellPrices)) {
      if (pricemap && typeof pricemap === "object") {
        for (const [size, price] of Object.entries(pricemap)) {
          if (!sizes[size]) sizes[size] = {};
          sizes[size][platform] = price;
        }
      }
    }
  }
  return sizes;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", cache_size: cache.size });
});

app.listen(PORT, () => {
  console.log(`Sneaks API service running on port ${PORT}`);
});
