const express = require("express");
const router = express.Router();
const blogController = require("../controllers/blog.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", blogController.listBlogs);
router.get("/admin", protect, requireAdmin, blogController.listAllBlogs);
router.get("/:slug", blogController.getBlog);

router.post("/", protect, requireAdmin, blogController.createBlog);
router.patch("/:id", protect, requireAdmin, blogController.updateBlog);
router.delete("/:id", protect, requireAdmin, blogController.deleteBlog);

module.exports = router;
