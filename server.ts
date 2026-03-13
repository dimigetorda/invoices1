import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.");
}

const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

async function initializeDefaults() {
  if (!supabase) return;
  const defaults = [
    { user_id: 'dimitar', pin: '0000', base_rate: 104.0, deployment_rate: 12.0, deployment_label: 'App Deployments', meeting_rate_unit: 2, meeting_rate_value: 5 },
    { user_id: 'gordana', pin: '0000', base_rate: 90.0, deployment_rate: 8.0, deployment_label: 'App Marketings', meeting_rate_unit: 2, meeting_rate_value: 5 }
  ];

  for (const def of defaults) {
    const { data } = await supabase.from('settings').select('user_id').eq('user_id', def.user_id).single();
    if (!data) {
      console.log(`Initializing default settings for ${def.user_id}`);
      await supabase.from('settings').insert(def);
    }
  }
}

const app = express();
const PORT = 3000;

app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    supabaseConfigured: !!(supabaseUrl && supabaseAnonKey),
    nodeEnv: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL
  });
});

app.get("/api/settings/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!supabase) {
    return res.status(503).json({ error: "Database not configured" });
  }
  try {
    let { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    
    if (!data && (userId === 'dimitar' || userId === 'gordana')) {
      const defaults: Record<string, any> = {
        dimitar: { user_id: 'dimitar', pin: '0000', base_rate: 104.0, deployment_rate: 12.0, deployment_label: 'App Deployments', meeting_rate_unit: 2, meeting_rate_value: 5 },
        gordana: { user_id: 'gordana', pin: '0000', base_rate: 90.0, deployment_rate: 8.0, deployment_label: 'App Marketings', meeting_rate_unit: 2, meeting_rate_value: 5 }
      };
      const def = defaults[userId];
      console.log(`On-the-fly initialization for ${userId}`);
      const { error: insertError } = await supabase.from('settings').insert(def);
      if (!insertError) {
        data = def;
      } else {
        console.error(`Failed on-the-fly init for ${userId}:`, insertError);
      }
    }

    res.json(data || null);
  } catch (error) {
    console.error("Fetch settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.post("/api/settings/:userId", async (req, res) => {
  const { userId } = req.params;
  const { pin, base_rate, deployment_rate, deployment_label, meeting_rate_unit, meeting_rate_value } = req.body;
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { error } = await supabase
      .from("settings")
      .upsert({
        user_id: userId,
        pin,
        base_rate,
        deployment_rate,
        deployment_label,
        meeting_rate_unit,
        meeting_rate_value
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Save settings error:", error);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

app.get("/api/all-invoices", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .order("period_start", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Fetch all invoices error:", error);
    res.status(500).json({ error: "Failed to fetch all invoices" });
  }
});

app.patch("/api/invoices/:id/payment", async (req, res) => {
  const { id } = req.params;
  const { is_paid, received_amount_eur } = req.body;
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { error } = await supabase
      .from("invoices")
      .update({
        is_paid,
        received_amount_eur,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Update payment status error:", error);
    res.status(500).json({ error: "Failed to update payment status" });
  }
});

app.get("/api/exchange-rate", async (req, res) => {
  try {
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await response.json();
    res.json({ rate: data.rates.EUR });
  } catch (error) {
    console.error("Fetch exchange rate error:", error);
    res.json({ rate: 0.95 });
  }
});

// Historical USD->EUR rate for a specific date (YYYY-MM-DD)
// Used to calculate what the EUR value was on the invoice due date
app.get("/api/exchange-rate/historical/:date", async (req, res) => {
  const { date } = req.params;

  // Try frankfurter.app first (free, reliable, no key needed)
  try {
    const response = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=EUR`);
    if (response.ok) {
      const data = await response.json();
      const rate = data.rates?.EUR;
      if (rate) {
        return res.json({ rate, date, source: "frankfurter" });
      }
    }
  } catch (_) {}

  // Fallback: current rate
  try {
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await response.json();
    return res.json({ rate: data.rates.EUR, date, source: "fallback-current" });
  } catch (_) {}

  res.json({ rate: 0.95, date, source: "hardcoded-fallback" });
});

app.get("/api/invoices/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("user_id", userId)
      .order("period_start", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Fetch invoices error:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

app.post("/api/invoices/:userId", async (req, res) => {
  const { userId } = req.params;
  const { id, period_start, period_end, app_deployments, custom_entries, meetings, base_rate } = req.body;
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { error } = await supabase
      .from("invoices")
      .upsert({
        id,
        user_id: userId,
        period_start,
        period_end,
        app_deployments: app_deployments || [],
        custom_entries: custom_entries || [],
        meetings,
        base_rate,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Save invoice error:", error);
    res.status(500).json({ error: "Failed to save invoice" });
  }
});

// FIXED: delete route scoped to userId to prevent cross-user deletion
app.delete("/api/invoices/:userId/:id", async (req, res) => {
  const { userId, id } = req.params;
  if (!supabase) return res.status(503).json({ error: "Database not configured" });
  try {
    const { error } = await supabase
      .from("invoices")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Delete invoice error:", error);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist/index.html"));
    });
  }
}

setupVite();

export default app;

if (supabaseUrl && supabaseAnonKey) {
  initializeDefaults();
}

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
