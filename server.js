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

  try {
    sneaks.getProducts(query, limit, (err, products) => {
      if (err) {
        console.error("Erreur getProducts:", err);
        return res.status(404).json({ error: "Aucun produit trouvé", query });
      }

      if (!products || products.length === 0) {
        return res.status(404).json({ error: "Aucun produit trouvé", query });
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
  } catch (e) {
    console.error("Exception search:", e);
    res.status(500).json({ error: "Erreur serveur", details: String(e) });
  }
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

  try {
    sneaks.getProducts(sku, 5, (err, products) => {
      if (err || !products || products.length === 0) {
        console.log("Produit non trouvé pour SKU:", sku);
        return res.status(404).json({ error: "Produit non trouvé", sku });
      }

      // Trouver le produit exact par SKU
      const product =
        products.find((p) => p.styleID?.toUpperCase() === sku.toUpperCase()) ||
        products[0];

      try {
        sneaks.getProductPrices(product, (err2, productWithPrices) => {
          if (err2 || !productWithPrices) {
            console.error("Erreur getProductPrices:", err2);
            // Retourner quand même les infos de base sans les prix détaillés
            return res.json({
              name: product.shoeName,
              brand: product.brand,
              sku: product.styleID,
              colorway: product.colorway,
              retail_price: product.retailPrice,
              thumbnail: product.thumbnail,
              error_prices: "Prix détaillés non disponibles",
              prices_by_size: {}
            });
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
      } catch (e2) {
        console.error("Exception getProductPrices:", e2);
        res.json({
          name: product.shoeName,
          brand: product.brand,
          sku: product.styleID,
          thumbnail: product.thumbnail,
          error_prices: "Erreur récupération prix",
          prices_by_size: {}
        });
      }
    });
  } catch (e) {
    console.error("Exception prices:", e);
    res.status(500).json({ error: "Erreur serveur", details: String(e) });
  }
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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", cache_size: cache.size });
});

// Test endpoint
app.get("/test", (req, res) => {
  res.json({ status: "ok", message: "Service is running" });
});

app.listen(PORT, () => {
  console.log(`Sneaks API service running on port ${PORT}`);
});
