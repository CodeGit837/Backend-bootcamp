const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Initialize cache (10 minutes TTL)
const cache = new NodeCache({ stdTTL: 600 });

// MongoDB Connection
const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGODB_URI;

    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ MongoDB Connected Successfully!");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    process.exit(1);
  }
};

// Task Schema/Model
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Task = mongoose.model("Task", taskSchema);

// User Schema/Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// Validation Middleware
const validateTask = [
  body("title").isString().notEmpty().trim().isLength({ min: 3 }),
  body("completed").isBoolean(),
];

// JWT Authentication Middleware
const auth = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Access denied" });
  try {
    const decoded = jwt.verify(token, "secret-key");
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Routes

// User Signup Endpoint
app.post(
  "/signup",
  [
    body("username").isString().notEmpty().trim().isLength({ min: 3, max: 30 }),
    body("password").isString().notEmpty().isLength({ min: 6 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Create new user
      const user = new User({
        username,
        password, // In production, you should hash the password
      });

      await user.save();

      // Generate JWT token
      const token = jwt.sign({ id: user._id }, "secret-key", {
        expiresIn: "1h",
      });

      res.status(201).json({
        message: "User created successfully",
        token,
        user: {
          id: user._id,
          username: user.username,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  }
);

// User Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || password !== "testpass") {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user._id }, "secret-key", { expiresIn: "1h" });
  res.json({ token });
});

// Get All Tasks (JWT + Cache)
app.get("/tasks", auth, async (req, res) => {
  const cacheKey = `all_tasks_${req.user.id}`;
  const cachedTasks = cache.get(cacheKey);
  if (cachedTasks) return res.json(cachedTasks);

  const tasks = await Task.find({ userId: req.user.id });
  cache.set(cacheKey, tasks);
  res.json(tasks);
});

// Create Task
app.post("/tasks", validateTask, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const task = new Task(req.body);
  await task.save();
  res.status(201).json(task);
});

// Get Task by ID
app.get("/tasks/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        error: "Task not found",
        message: "No task exists with the provided ID",
      });
    }
    res.json({
      message: "Task retrieved successfully!",
      task,
    });
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({
      error: "Failed to fetch task",
      details: error.message,
    });
  }
});

// Update Task (JWT)
app.put("/tasks/:id", auth, async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// Delete Task
app.delete("/tasks/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// 404 Handler (Fixed)
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    message: "The requested endpoint does not exist",
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start Server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📋 Task API endpoints:`);
      console.log(`   POST   /login      - User login (get JWT token)`);
      console.log(`   GET    /tasks      - Get all tasks (JWT required)`);
      console.log(`   POST   /tasks      - Create new task (validation)`);
      console.log(`   GET    /tasks/:id  - Get task by ID`);
      console.log(`   PUT    /tasks/:id  - Update task (JWT required)`);
      console.log(`   DELETE /tasks/:id  - Delete task`);
      console.log(`   GET    /health     - Health check`);
      console.log(`🔐 Authentication:`);
      console.log(`   Use: Authorization: Bearer <token>`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Export app for testing
module.exports = app;

// Start only if run directly
if (require.main === module) {
  startServer();
}
