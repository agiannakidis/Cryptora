require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/entities', require('./routes/entities'));
app.use('/api/functions', require('./routes/functions'));
app.use('/api/functions', require('./routes/walletApi'));
app.use('/api/apps', require('./routes/app'));

app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/ticker", require("./routes/ticker"));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🎰 Casino backend running on port ${PORT}`);
});
