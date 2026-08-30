// Run with: node src/scripts/seedBlogs.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Blog = require("../models/Blog");
const User = require("../models/User");

const blogs = [
  {
    title: "How to Build a High-Converting AI Chatbot for your SaaS",
    slug: "build-ai-chatbot-saas",
    excerpt: "Learn the key strategies for designing AI chatbots that don't just answer questions, but actually drive user activation and retention.",
    content: "<h2>The Power of AI in SaaS</h2><p>AI chatbots have evolved from simple decision trees to sophisticated assistants that can understand context and intent. For SaaS companies, this means a huge opportunity to reduce churn and increase LTV.</p><h3>1. Focus on Activation</h3><p>The first 5 minutes of a user's experience are critical. Your chatbot should guide them through the 'Aha! moment' rather than just providing a help manual.</p><h3>2. Integration with Product Data</h3><p>A chatbot that knows which plan the user is on and what features they've used is 10x more effective than a generic one. Use tool-calling to fetch user data in real-time.</p><h3>3. Human Handoff</h3><p>Don't let the AI be a wall. When a user is frustrated or needs high-touch support, a seamless transition to a human agent is mandatory.</p><div class='code-block'><pre><code class='language-javascript'>// Example: Triggering a human handover\nif (userSentiment === 'frustrated') {\n  bot.triggerHandover('support-team');\n}</code></pre></div>",
    coverImage: "https://images.unsplash.com/photo-1531482615713-2K678276608",
    tags: ["SaaS", "AI Strategy", "User Experience"],
    published: true,
  },
  {
    title: "The Future of Customer Support: From Tickets to Conversations",
    slug: "future-customer-support",
    excerpt: "Why the traditional ticketing system is dying and how conversational AI is creating a new standard for customer satisfaction.",
    content: "<h2>The End of 'Ticket #4052'</h2><p>Nobody likes waiting 24 hours for an email response. The modern customer expects instant gratification. Conversational AI allows companies to provide 24/7 support without hiring an army of agents.</p><h3>The Shift to Proactive Support</h3><p>Imagine a bot that notices a user is struggling with a specific feature and reaches out *before* they even think to ask for help. That is the future of support.</p><h3>Grounding AI in Documentation (RAG)</h3><p>The biggest fear with AI is hallucinations. By grounding your bot in your own verified documentation (Retrieval Augmented Generation), you ensure that every answer is accurate and safe.</p><div class='code-block'><pre><code class='language-javascript'>// RAG Pipeline simplified\nconst context = await vectorDb.search(userQuery);\nconst response = await llm.generate(context, userQuery);</code></pre></div>",
    coverImage: "https://images.unsplash.com/photo-1557200134-9032B6a76f52",
    tags: ["Customer Support", "AI Trends", "RAG"],
    published: true,
  },
  {
    title: "Scaling Your Expertise: How Coaches can use AI Chatbots",
    slug: "ai-for-coaching",
    excerpt: "Coaches can only be in one place at a time. Learn how to clone your knowledge into an AI assistant that supports your clients 24/7.",
    content: "<h2>Scaling the Unscalable</h2><p>Coaching is deeply personal, but the bulk of a coach's time is spent repeating the same foundational advice. An AI bot trained on your specific methodology can handle the basics, leaving you free for the deep work.</p><h3>Training your 'Digital Twin'</h3><p>The secret to a good coaching bot is the source material. Feed it your transcripts, your book, and your course materials. The more 'you' it sounds, the more value it provides.</p><h3>Maintaining the Human Touch</h3><p>The bot should be the gateway, not the destination. Use it to qualify leads and answer common questions, then schedule a 1-on-1 call for the real transformation.</p>",
    coverImage: "https://images.unsplash.com/photo-1517245386807-bb43f82c",
    tags: ["Coaching", "Productivity", "Knowledge Management"],
    published: true,
  },
  {
    title: "Mastering RAG: The Secret to Zero-Hallucination AI",
    slug: "mastering-rag",
    excerpt: "A deep dive into Retrieval Augmented Generation (RAG) and how to build a knowledge base that your AI can actually trust.",
    content: "<h2>What is RAG?</h2><p>Retrieval Augmented Generation (RAG) is the process of providing an LLM with specific, retrieved documents to use as a reference before generating a response. This transforms the AI from a 'know-it-all' that might lie, into a 'researcher' that cites its sources.</p><h3>The RAG Pipeline</h3><p>1. **Ingestion**: Converting documents into embeddings.<br>2. **Retrieval**: Finding the most relevant chunks using vector similarity.<br>3. **Generation**: Passing those chunks to the LLM as 'context'.</p><div class='code-block'><pre><code class='language-javascript'>// Example prompt structure\n`Answer the question using ONLY the following context:\n\n${context}\n\nQuestion: ${userQuery}`</code></pre></div>",
    coverImage: "https://images.unsplash.com/photo-1551288049-bebda4e38a71",
    tags: ["RAG", "LLM", "Engineering"],
    published: true,
  },
  {
    title: "AI for Agencies: Scaling Client Delivery without Adding Headcount",
    slug: "ai-for-agencies",
    excerpt: "How modern agencies are using AI bots to handle client onboarding, FAQs, and lead qualification at scale.",
    content: "<h2>The Agency Bottleneck</h2><p>Agencies often struggle with the 'delivery gap' — where the number of clients grows faster than the ability to support them. AI assistants can bridge this gap by handling the 80% of common requests.</p><h3>Case Study: Automated Onboarding</h3><p>Instead of a 60-minute kick-off call for every client, a specialized onboarding bot can collect requirements, answer common setup questions, and only flag the account manager when a complex issue arises.</p><h3>White-labeling your AI</h3><p>Offering a custom-trained AI bot as a value-add to your clients can increase your retainer value and make your agency indispensable.</p>",
    coverImage: "https://images.unsplash.com/photo-1460925895917-afbe65ae8364",
    tags: ["Agencies", "Scaling", "Automation"],
    published: true,
  },
  {
    title: "Beyond the Chatbox: Integrating AI into your Business Workflow",
    slug: "ai-business-workflow",
    excerpt: "Stop thinking of AI as just a 'chat bubble'. Learn how to use tool-calling to let your AI actually DO work in your other apps.",
    content: "<h2>The Evolution of AI Agency</h2><p>The first wave of AI was 'Ask and Answer'. The second wave is 'Do and Deliver'. By giving your AI tools (API access), it can now book meetings, update CRM records, and send emails.</p><h3>Example Workflow: The Lead Machine</h3><p>1. Bot qualifies the lead in the chat.<br>2. Bot uses a tool to check the agent's calendar.<br>3. Bot books the meeting in Google Calendar.<br>4. Bot sends a confirmation email via SendGrid.</p><div class='code-block'><pre><code class='language-javascript'>// Tool definition for booking\n{ name: 'book_meeting', parameters: { date: 'string', time: 'string' } }</code></pre></div>",
    coverImage: "https://images.unsplash.com/photo-1454165833767-027ffbc9969b",
    tags: ["Workflow", "Automation", "API"],
    published: true,
  },
  {
    title: "The Ethics of AI: Transparency, Trust, and the Human Element",
    slug: "ai-ethics-trust",
    excerpt: "As AI becomes invisible, the need for transparency becomes critical. How to build trust with your users in the age of synthetic content.",
    content: "<h2>The Transparency Paradox</h2><p>Users love the speed of AI, but they hate being lied to. The most successful AI implementations are those that are honest about their nature.</p><h3>Best Practices for AI Trust</h3><ul><li>Always disclose that the user is talking to an AI.</li><li>Provide a clear path to a human agent.</li><li>Allow users to see the 'source' of the AI's information.</li></ul><p>Trust is hard to build and easy to destroy. A single high-profile hallucination can ruin a brand's reputation.</p>",
    coverImage: "https://images.unsplash.com/photo-1507146426996-ef05306B995a",
    tags: ["Ethics", "Trust", "AI Strategy"],
    published: true,
  },
  {
    title: "Why Every Website Needs a Knowledge-Based AI Assistant in 2026",
    slug: "why-ai-assistant-2026",
    excerpt: "Static FAQs are dead. Interactive knowledge bases are the new standard for the modern web. Here is why.",
    content: "<h2>The Death of the FAQ Page</h2><p>Users no longer want to browse a list of 50 questions to find the one that matches their problem. They want to ask their question and get a direct, accurate answer immediately.</p><h3>Conversion and Retention</h3><p>A well-implemented AI assistant doesn't just reduce support tickets; it increases conversion. By answering a critical doubt in real-time, the AI removes the friction that prevents a user from signing up.</p><h3>The Competitive Edge</h3><p>In a crowded market, the company that provides the lowest friction to the 'Aha! moment' wins. AI is the ultimate friction-remover.</p>",
    coverImage: "https://images.unsplash.com/photo-1519389950473-47ba02//",
    tags: ["Conversion", "Web Design", "AI Trends"],
    published: true,
  },
];

const run = async () => {
  await connectDB();

  let admin = await User.findOne({ role: "admin" });
  if (!admin) {
    console.log("No admin user found. Creating one for blog authorship...");
    admin = await User.create({
      name: "JestBot Admin",
      email: "jestbotai@gmail.com",
      role: "admin",
      password: "password123",
    });
  }

  for (const blog of blogs) {
    await Blog.findOneAndUpdate(
      { slug: blog.slug },
      {
        ...blog,
        author: admin._id,
        publishedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    console.log(`Upserted blog: ${blog.title}`);
  }

  console.log("Done seeding blogs.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
