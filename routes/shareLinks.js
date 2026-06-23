import express from "express";

export default function shareLinksRouter() {
  const router = express.Router();

  router.get("/products/:handle", (req, res) => {
    res.redirect(302, `https://halabt.com/products/${req.params.handle}`);
  });

  router.get("/collections/vendors", (req, res) => {
    const q = req.query && req.query.q ? `?q=${encodeURIComponent(String(req.query.q))}` : "";
    res.redirect(302, `https://halabt.com/collections/vendors${q}`);
  });

  router.get("/collections/:handle", (req, res) => {
    res.redirect(302, `https://halabt.com/collections/${req.params.handle}`);
  });

  router.get("/blogs/:blogHandle/:articleHandle", (req, res) => {
    res.redirect(302, `https://halabt.com/blogs/${req.params.blogHandle}/${req.params.articleHandle}`);
  });

  router.get("/en/products/:handle", (req, res) => {
    res.redirect(302, `https://halabt.com/en/products/${req.params.handle}`);
  });

  router.get("/en/collections/vendors", (req, res) => {
    const q = req.query && req.query.q ? `?q=${encodeURIComponent(String(req.query.q))}` : "";
    res.redirect(302, `https://halabt.com/en/collections/vendors${q}`);
  });

  router.get("/en/collections/:handle", (req, res) => {
    res.redirect(302, `https://halabt.com/en/collections/${req.params.handle}`);
  });

  router.get("/en/blogs/:blogHandle/:articleHandle", (req, res) => {
    res.redirect(302, `https://halabt.com/en/blogs/${req.params.blogHandle}/${req.params.articleHandle}`);
  });

  router.get("/.well-known/assetlinks.json", (req, res) => {
    res.type("application/json");
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.btime.app",
          sha256_cert_fingerprints: [
            "CA:46:60:8F:CF:FC:60:51:83:E4:4D:54:98:56:7F:53:94:9F:69:FF:B6:3B:C7:4F:CA:F5:96:25:E3:D6:B7:7E",
            "00:67:9D:F5:67:0C:35:A6:BD:86:AE:77:71:31:87:46:31:8C:7A:2F:9C:31:A5:36:24:12:E5:E7:13:73:96:97"
          ]
        }
      }
    ]);
  });

  router.get("/.well-known/apple-app-site-association", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json({
      applinks: {
        details: [
          {
            appIDs: ["6FVRZZP2DM.com.btime.app"],
            components: [{ "/": "/*", comment: "Matches all URLs" }]
          }
        ]
      }
    });
  });

  return router;
}
