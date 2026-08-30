const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Blog = require("../models/Blog");

// Public: List all published blogs
const listBlogs = asyncHandler(async (req, res) => {
  const blogs = await Blog.find({ published: true }).sort({ publishedAt: -1 });
  res.status(200).json({ success: true, data: { blogs } });
});

// Admin: List all blogs (including drafts)
const listAllBlogs = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const filter = {};
  if (status) filter.published = status === "published";
  if (search) {
    filter.$or = [
      { title: new RegExp(search, "i") },
      { content: new RegExp(search, "i") },
    ];
  }

  const blogs = await Blog.find(filter)
    .populate("author", "name email")
    .sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: { blogs } });
});

// Public: Get a single published blog by slug
const getBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findOne({ slug: req.params.slug, published: true }).populate("author", "name email");
  if (!blog) throw new ApiError(404, "Blog post not found");
  res.status(200).json({ success: true, data: { blog } });
});

// Admin: Create a blog post
const createBlog = asyncHandler(async (req, res) => {
  const { title, content, excerpt, coverImage, tags, published } = req.body;
  if (!title || !content) throw new ApiError(400, "Title and content are required");

  const slug = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");

  const blog = await Blog.create({
    title,
    slug,
    content,
    excerpt,
    coverImage,
    tags,
    published,
    author: req.user._id,
    publishedAt: published ? new Date() : null,
  });

  res.status(201).json({ success: true, data: { blog } });
});

// Admin: Update a blog post
const updateBlog = asyncHandler(async (req, res) => {
  const { title, content, excerpt, coverImage, tags, published } = req.body;
  const blog = await Blog.findByIdAndUpdate(
    req.params.id,
    {
      title,
      content,
      excerpt,
      coverImage,
      tags,
      published,
      publishedAt: published ? new Date() : null,
    },
    { new: true }
  );
  if (!blog) throw new ApiError(404, "Blog post not found");
  res.status(200).json({ success: true, data: { blog } });
});

// Admin: Delete a blog post
const deleteBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findByIdAndDelete(req.params.id);
  if (!blog) throw new ApiError(404, "Blog post not found");
  res.status(200).json({ success: true, message: "Blog post deleted" });
});

module.exports = { listBlogs, listAllBlogs, getBlog, createBlog, updateBlog, deleteBlog };
