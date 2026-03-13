import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, 
  Plus, 
  Save, 
  Clock, 
  DollarSign, 
  ChevronRight, 
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  FileText,
  TrendingUp,
  X,
  Download,
  Trash2,
  Settings as SettingsIcon,
  User as UserIcon,
  Lock,
  ArrowLeft,
  LogOut,
  LayoutGrid,
  Globe,
  Euro,
  CreditCard,
  Loader2,
  TrendingDown,
  BadgeEuro,
  Banknote,
  ReceiptEuro
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface AppDeployment {
  id: string;
  details: string;
}

interface CustomEntry {
  id: string;
  description: string;
  amount: number;
}

interface UserSettings {
  user_id: string;
  pin: string;
  base_rate: number;
  deployment_rate: number;
  deployment_label: string;
  meeting_rate_unit: number;
  meeting_rate_value: number;
}

interface InvoiceData {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  app_deployments: AppDeployment[];
  meetings: number;
  base_rate: number;
  custom_entries: CustomEntry[];
  is_paid?: boolean;
  received_amount_eur?: number;
  updated_at?: string;
}

interface Period {
  id: string;
  label: string;
  start: Date;
  end: Date;
  paymentDate: Date;
  isFuture: boolean;
  isCurrent: boolean;
}

// A combined period row in Global Overview — one row per period with both users summed
interface PeriodGroup {
  periodKey: string;       // e.g. "2026-3-1"
  periodLabel: string;     // e.g. "3.1-3.14"
  paymentDate: Date;
  invoices: InvoiceData[]; // all invoices (both users) for this period
  totalUsd: number;        // sum of both users
  historicalRate: number | null; // EUR rate on payment due date
  estimatedEur: number | null;   // totalUsd * historicalRate
  estimatedReceived: number | null; // after estimated fee
  allPaid: boolean;
  anyPaid: boolean;
  totalReceivedEur: number; // sum of entered received EUR across all invoices
}

// --- Helpers ---
const getPaymentDate = (periodEndDate: Date): Date => {
  const date = new Date(periodEndDate);
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() - 2);
  else if (day === 6) date.setDate(date.getDate() - 1);
  return date;
};

const generatePeriods = (targetYear: number): Period[] => {
  const now = new Date();
  const periods: Period[] = [];
  const year = targetYear;

  for (let month = 0; month < 12; month++) {
    const p1Start = new Date(year, month, 1);
    const p1End = new Date(year, month, 14);
    const p2Start = new Date(year, month, 15);
    const p2End = new Date(year, month + 1, 0);

    [
      { start: p1Start, end: p1End },
      { start: p2Start, end: p2End }
    ].forEach(({ start, end }) => {
      const id = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
      const label = `${start.getMonth() + 1}.${start.getDate()}-${end.getMonth() + 1}.${end.getDate()}`;
      const isFuture = start > now;
      const isCurrent = now >= start && now <= end;
      periods.push({ id, label, start, end, paymentDate: getPaymentDate(end), isFuture, isCurrent });
    });
  }
  return periods;
};

// Format a Date as YYYY-MM-DD for the historical rate API
const toDateString = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function App() {
  const currentYear = new Date().getFullYear();
  const [availableYears] = useState([currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const periods = useMemo(() => generatePeriods(selectedYear), [selectedYear]);

  const [currentUser, setCurrentUser] = useState<'dimitar' | 'gordana' | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGlobalOverview, setShowGlobalOverview] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [allUserSettings, setAllUserSettings] = useState<Record<string, UserSettings>>({});
  const [pinInput, setPinInput] = useState('');
  const [systemStatus, setSystemStatus] = useState<{ ok: boolean, supabase: boolean } | null>(null);

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Record<string, InvoiceData>>({});
  const [allInvoices, setAllInvoices] = useState<InvoiceData[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(0.95);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Global overview state
  const [periodGroups, setPeriodGroups] = useState<PeriodGroup[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  // Cache historical rates so we don't re-fetch on every render
  const [historicalRateCache, setHistoricalRateCache] = useState<Record<string, number>>({});

  const [editData, setEditData] = useState<InvoiceData | null>(null);
  const [newDeployment, setNewDeployment] = useState('');
  const [newCustomEntryDescription, setNewCustomEntryDescription] = useState('');
  const [newCustomEntryAmount, setNewCustomEntryAmount] = useState<number>(0);

  const currentPeriod = useMemo(() => {
    return periods.find(p => p.isCurrent) || periods[0];
  }, [periods]);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setSystemStatus({ ok: data.status === 'ok', supabase: data.supabaseConfigured }))
      .catch(() => setSystemStatus({ ok: false, supabase: false }));
  }, []);

  useEffect(() => {
    if (currentUser && isAuthenticated) {
      fetchInvoices();
      fetchSettings();
      setSelectedPeriodId(currentPeriod.id);
    }
  }, [currentUser, isAuthenticated, currentPeriod]);

  const fetchSettings = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/settings/${currentUser}`);
      const data = await res.json();
      setUserSettings(data);
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  // Calculate average fee ratio from paid invoices that have both EUR total and received EUR
  const calcAverageFeeRatio = useCallback((invoiceList: InvoiceData[], settings: Record<string, UserSettings>): number => {
    const paidWithData = invoiceList.filter(inv =>
      inv.is_paid &&
      inv.received_amount_eur != null &&
      inv.received_amount_eur > 0
    );
    if (paidWithData.length === 0) return 0.02; // default 2% fee assumption

    // We need to find the historical rate for each to get the theoretical EUR amount.
    // For simplicity here (ratio calc), use the known received vs. estimated from cache.
    // The ratio is: fee = 1 - (received / estimated_eur)
    // We'll approximate using the cached rates if available, else just use 2% default.
    const ratios: number[] = [];
    for (const inv of paidWithData) {
      const s = settings[inv.user_id];
      if (!s) continue;
      const usd = calcInvoiceTotal(inv, s);
      // Try to get historical rate for this invoice's payment date
      const pEnd = new Date(inv.period_end);
      const payDate = getPaymentDate(pEnd);
      const dateKey = toDateString(payDate);
      const rate = historicalRateCache[dateKey];
      if (rate) {
        const theoreticalEur = usd * rate;
        if (theoreticalEur > 0 && inv.received_amount_eur! < theoreticalEur) {
          ratios.push(1 - inv.received_amount_eur! / theoreticalEur);
        }
      }
    }
    if (ratios.length === 0) return 0.02;
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }, [historicalRateCache]);

  const calcInvoiceTotal = (inv: InvoiceData, settings: UserSettings): number => {
    const appTotal = inv.app_deployments.length * settings.deployment_rate;
    const meetingTotal = Math.floor(inv.meetings / settings.meeting_rate_unit) * settings.meeting_rate_value;
    const customTotal = (inv.custom_entries || []).reduce((s, e) => s + e.amount, 0);
    return inv.base_rate + appTotal + meetingTotal + customTotal;
  };

  // Build period groups from allInvoices, fetching historical rates as needed
  const buildPeriodGroups = useCallback(async (
    invoiceList: InvoiceData[],
    settings: Record<string, UserSettings>,
    rateCache: Record<string, number>
  ) => {
    // Group invoices by their period key (strip user prefix)
    const groupMap: Record<string, InvoiceData[]> = {};
    for (const inv of invoiceList) {
      // period key is the part after "username-"
      const periodKey = inv.id.startsWith('dimitar-') ? inv.id.slice('dimitar-'.length)
        : inv.id.startsWith('gordana-') ? inv.id.slice('gordana-'.length)
        : inv.id;
      if (!groupMap[periodKey]) groupMap[periodKey] = [];
      groupMap[periodKey].push(inv);
    }

    // Find all dates we need rates for that aren't cached
    const datesToFetch: string[] = [];
    for (const [periodKey, invList] of Object.entries(groupMap)) {
      const sampleInv = invList[0];
      const pEnd = new Date(sampleInv.period_end);
      const payDate = getPaymentDate(pEnd);
      const dateKey = toDateString(payDate);
      if (!rateCache[dateKey]) datesToFetch.push(dateKey);
    }

    // Also fetch for any paid invoices we need for fee ratio calc
    const uniqueDates = [...new Set(datesToFetch)];
    const newCache = { ...rateCache };

    if (uniqueDates.length > 0) {
      setLoadingRates(true);
      await Promise.all(uniqueDates.map(async (dateKey) => {
        try {
          const res = await fetch(`/api/exchange-rate/historical/${dateKey}`);
          const data = await res.json();
          if (data.rate) newCache[dateKey] = data.rate;
        } catch (_) {}
      }));
      setHistoricalRateCache(newCache);
      setLoadingRates(false);
    }

    // Compute average fee ratio from paid invoices
    const avgFeeRatio = calcAverageFeeRatio(invoiceList, settings);

    // Build groups
    const groups: PeriodGroup[] = [];
    for (const [periodKey, invList] of Object.entries(groupMap)) {
      const sampleInv = invList[0];
      const pEnd = new Date(sampleInv.period_end);
      const payDate = getPaymentDate(pEnd);
      const dateKey = toDateString(payDate);
      const rate = newCache[dateKey] ?? null;

      // Find the matching period label
      const allPeriods = generatePeriods(new Date(sampleInv.period_start).getFullYear());
      const matchedPeriod = allPeriods.find(p => p.id === periodKey);
      const periodLabel = matchedPeriod?.label ?? periodKey;

      const totalUsd = invList.reduce((sum, inv) => {
        const s = settings[inv.user_id];
        return sum + (s ? calcInvoiceTotal(inv, s) : 0);
      }, 0);

      const estimatedEur = rate != null ? totalUsd * rate : null;
      const estimatedReceived = estimatedEur != null ? estimatedEur * (1 - avgFeeRatio) : null;
      const allPaid = invList.every(inv => inv.is_paid);
      const anyPaid = invList.some(inv => inv.is_paid);
      const totalReceivedEur = invList.reduce((sum, inv) => sum + (inv.received_amount_eur || 0), 0);

      groups.push({
        periodKey,
        periodLabel,
        paymentDate: payDate,
        invoices: invList,
        totalUsd,
        historicalRate: rate,
        estimatedEur,
        estimatedReceived,
        allPaid,
        anyPaid,
        totalReceivedEur,
      });
    }

    // Sort by payment date descending
    groups.sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime());
    setPeriodGroups(groups);
  }, [calcAverageFeeRatio]);

  const fetchGlobalData = async () => {
    setLoading(true);
    try {
      const [invRes, rateRes, dimitarSettings, gordanaSettings] = await Promise.all([
        fetch('/api/all-invoices'),
        fetch('/api/exchange-rate'),
        fetch('/api/settings/dimitar'),
        fetch('/api/settings/gordana')
      ]);
      
      const invoicesData: InvoiceData[] = await invRes.json();
      const rateData = await rateRes.json();
      const dimSettings = await dimitarSettings.json();
      const gorSettings = await gordanaSettings.json();

      const settings = { dimitar: dimSettings, gordana: gorSettings };

      setAllInvoices(invoicesData);
      setExchangeRate(rateData.rate);
      setAllUserSettings(settings);

      await buildPeriodGroups(invoicesData, settings, historicalRateCache);
    } catch (err) {
      console.error("Failed to fetch global data", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoices = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${currentUser}`);
      const data: InvoiceData[] = await res.json();
      const map = data.reduce((acc, inv) => {
        const periodId = inv.id.startsWith(`${currentUser}-`) 
          ? inv.id.slice(currentUser.length + 1) 
          : inv.id;
        return { ...acc, [periodId]: inv };
      }, {} as Record<string, InvoiceData>);
      setInvoices(map);
    } catch (err) {
      console.error("Failed to fetch invoices", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userSettings && pinInput === userSettings.pin) {
      setIsAuthenticated(true);
      setPinInput('');
    } else {
      setMessage({ type: 'error', text: 'Incorrect PIN' });
      setTimeout(() => setMessage(null), 2000);
      setPinInput('');
    }
  };

  const handleUserSelect = async (user: 'dimitar' | 'gordana') => {
    setCurrentUser(user);
    try {
      const res = await fetch(`/api/settings/${user}`);
      const data = await res.json();
      setUserSettings(data);
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setIsAuthenticated(false);
    setShowSettings(false);
    setPinInput('');
  };

  const selectedPeriod = useMemo(() => {
    return periods.find(p => p.id === selectedPeriodId) || null;
  }, [selectedPeriodId, periods]);

  const isSaved = selectedPeriod && invoices[selectedPeriod.id];

  const handleExport = () => {
    if (!editData || !selectedPeriod || !userSettings) return;
    const total = calculateTotal(editData);
    const meetingSubtotal = Math.floor(editData.meetings / userSettings.meeting_rate_unit) * userSettings.meeting_rate_value;

    let tableHtml = `
      <style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse;width:100%;max-width:600px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f2f2}tr:last-child td{font-weight:bold}</style>
      <h2>Invoice for ${selectedPeriod.label}</h2>
      <table><tr><td>Payment period</td><td>${selectedPeriod.label}</td></tr>
    `;
    editData.app_deployments.forEach(dep => {
      tableHtml += `<tr><td>${dep.details}</td><td>${userSettings.deployment_rate.toFixed(2)}</td></tr>`;
    });
    editData.custom_entries.forEach(entry => {
      tableHtml += `<tr><td>${entry.description}</td><td>${entry.amount.toFixed(2)}</td></tr>`;
    });
    tableHtml += `
      <tr><td>Meetings (${editData.meetings} total, ${userSettings.meeting_rate_unit}x${userSettings.meeting_rate_value/userSettings.meeting_rate_unit}USD)</td><td>${meetingSubtotal.toFixed(2)}</td></tr>
      <tr><td>Base rate</td><td>${editData.base_rate.toFixed(2)}</td></tr>
      <tr><td>Total in USD</td><td>${total.toFixed(2)}</td></tr>
      </table>
    `;
    const w = window.open();
    if (w) { w.document.write(tableHtml); w.document.close(); }
  };

  useEffect(() => {
    if (selectedPeriod && userSettings && currentUser) {
      const existing = invoices[selectedPeriod.id];
      setEditData(existing || {
        id: `${currentUser}-${selectedPeriod.id}`,
        user_id: currentUser,
        period_start: selectedPeriod.start.toISOString(),
        period_end: selectedPeriod.end.toISOString(),
        app_deployments: [],
        meetings: 0,
        base_rate: userSettings.base_rate,
        custom_entries: []
      });
    }
  }, [selectedPeriod, invoices, userSettings, currentUser]);

  const calculateTotal = (data: InvoiceData | null, settings: UserSettings | null = userSettings) => {
    if (!data || !settings) return 0;
    const appTotal = data.app_deployments.length * settings.deployment_rate;
    const meetingTotal = Math.floor(data.meetings / settings.meeting_rate_unit) * settings.meeting_rate_value;
    const customTotal = data.custom_entries.reduce((sum, entry) => sum + entry.amount, 0);
    return data.base_rate + appTotal + meetingTotal + customTotal;
  };

  // Update a single invoice's payment status, then rebuild period groups
  const handleUpdatePaymentStatus = async (id: string, isPaid: boolean, receivedEur: number) => {
    try {
      const res = await fetch(`/api/invoices/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_paid: isPaid, received_amount_eur: receivedEur })
      });
      if (res.ok) {
        const updatedAll = allInvoices.map(inv =>
          inv.id === id ? { ...inv, is_paid: isPaid, received_amount_eur: receivedEur } : inv
        );
        setAllInvoices(updatedAll);
        if (invoices[id]) {
          setInvoices(prev => ({ ...prev, [id]: { ...prev[id], is_paid: isPaid, received_amount_eur: receivedEur } }));
        }
        // Rebuild groups with updated data
        await buildPeriodGroups(updatedAll, allUserSettings, historicalRateCache);
      }
    } catch (err) {
      console.error("Failed to update payment status", err);
    }
  };

  const handleAddDeployment = () => {
    if (newDeployment.trim() && editData && userSettings) {
      const deploymentDetails = newDeployment.trim();
      const allExisting = Object.values(invoices).flatMap((inv: InvoiceData) =>
        inv.app_deployments.map(d => d.details.toLowerCase())
      );
      const current = editData.app_deployments.map(d => d.details.toLowerCase());
      if (allExisting.includes(deploymentDetails.toLowerCase()) || current.includes(deploymentDetails.toLowerCase())) {
        setMessage({ type: 'error', text: `Warning: Duplicate ${userSettings.deployment_label.toLowerCase()}. Added anyway.` });
        setTimeout(() => setMessage(null), 4000);
      }
      setEditData({ ...editData, app_deployments: [...editData.app_deployments, { id: Date.now().toString() + Math.random().toString(36).substr(2, 4), details: deploymentDetails }] });
      setNewDeployment('');
    }
  };

  const handleAddCustomEntry = () => {
    if (newCustomEntryDescription.trim() && editData) {
      setEditData({ ...editData, custom_entries: [...editData.custom_entries, { id: Date.now().toString(), description: newCustomEntryDescription.trim(), amount: newCustomEntryAmount }] });
      setNewCustomEntryDescription('');
      setNewCustomEntryAmount(0);
    }
  };

  const handleRemoveCustomEntry = (id: string) => {
    if (editData) setEditData({ ...editData, custom_entries: editData.custom_entries.filter(e => e.id !== id) });
  };

  const handleRemoveDeployment = (id: string) => {
    if (editData) setEditData({ ...editData, app_deployments: editData.app_deployments.filter(d => d.id !== id) });
  };

  const handleDeleteInvoice = async () => {
    if (!selectedPeriod || !invoices[selectedPeriod.id] || !currentUser) return;
    if (!confirm("Are you sure you want to delete this entire invoice? This cannot be undone.")) return;
    setSaving(true);
    try {
      const invoiceId = invoices[selectedPeriod.id].id;
      const res = await fetch(`/api/invoices/${currentUser}/${invoiceId}`, { method: 'DELETE' });
      if (res.ok) {
        setInvoices(prev => { const next = { ...prev }; delete next[selectedPeriod.id]; return next; });
        setMessage({ type: 'success', text: 'Invoice deleted successfully.' });
        setTimeout(() => setMessage(null), 3000);
      } else throw new Error("Failed to delete");
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to delete invoice.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editData || !selectedPeriod || selectedPeriod.isFuture || !currentUser) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/invoices/${currentUser}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      });
      if (res.ok) {
        setInvoices(prev => ({ ...prev, [selectedPeriod.id]: editData }));
        setMessage({ type: 'success', text: 'Invoice saved successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else throw new Error("Failed to save");
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save invoice.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userSettings || !currentUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/${currentUser}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userSettings)
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings updated successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else throw new Error("Failed to save settings");
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const formatShortDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // --- RENDER: Login ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-white rounded-[40px] border border-stone-200 shadow-2xl p-10 text-center">
          <div className="bg-stone-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-serif font-bold mb-2">Welcome</h1>
          <p className="text-stone-500 mb-10">Select your account to continue</p>
          {systemStatus && !systemStatus.supabase && (
            <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-800 text-sm text-left">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p><strong>Database not configured.</strong> Please set SUPABASE_URL and SUPABASE_ANON_KEY.</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            {(['dimitar', 'gordana'] as const).map(user => (
              <button key={user} onClick={() => handleUserSelect(user)} className="flex items-center justify-between p-6 bg-stone-50 hover:bg-stone-100 rounded-3xl border border-stone-200 transition-all group">
                <div className="flex items-center gap-4">
                  <div className="bg-stone-900 text-white p-3 rounded-xl group-hover:scale-110 transition-transform"><UserIcon className="w-6 h-6" /></div>
                  <div className="text-left">
                    <div className="font-bold text-lg capitalize">{user}</div>
                    <div className="text-xs text-stone-400 uppercase tracking-widest font-bold">Account Holder</div>
                  </div>
                </div>
                <ChevronRight className="text-stone-300 group-hover:translate-x-1 transition-transform" />
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  // --- RENDER: PIN ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full bg-white rounded-[40px] border border-stone-200 shadow-2xl p-10 text-center">
          <button onClick={() => setCurrentUser(null)} className="absolute top-8 left-8 p-2 text-stone-400 hover:text-stone-900 transition-colors"><ArrowLeft className="w-6 h-6" /></button>
          <div className="bg-stone-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8"><Lock className="text-white w-8 h-8" /></div>
          <h1 className="text-3xl font-serif font-bold mb-2 capitalize">{currentUser}</h1>
          <p className="text-stone-500 mb-10">Enter your 4-digit PIN</p>
          <form onSubmit={handlePinSubmit} className="space-y-6">
            <input type="password" maxLength={4} autoFocus value={pinInput} onChange={(e) => setPinInput(e.target.value)} className="w-full text-center text-4xl tracking-[1em] font-bold bg-stone-50 border border-stone-200 rounded-2xl py-6 focus:ring-2 focus:ring-stone-900 outline-none transition-all" placeholder="••••" />
            {message && <p className="text-rose-600 text-sm font-bold">{message.text}</p>}
            <button type="submit" className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 active:scale-95 transition-all shadow-lg shadow-stone-200">Unlock Account</button>
          </form>
        </motion.div>
      </div>
    );
  }

  // --- RENDER: Settings ---
  if (showSettings && userSettings) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] text-stone-900 font-sans">
        <header className="border-b border-stone-200 bg-white/50 backdrop-blur-md sticky top-0 z-10 px-6 py-4">
          <div className="max-w-3xl mx-auto flex justify-between items-center">
            <button onClick={() => setShowSettings(false)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 font-bold transition-colors"><ArrowLeft className="w-5 h-5" />Back to Dashboard</button>
            <h1 className="text-xl font-serif font-bold">Settings</h1>
            <div className="w-20"></div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[32px] border border-stone-200 shadow-xl p-8 space-y-10">
            <form onSubmit={handleSaveSettings} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { label: 'Account PIN', key: 'pin', type: 'text', max: 4 },
                  { label: 'Base Rate (USD)', key: 'base_rate', type: 'number' },
                  { label: 'Deployment Label', key: 'deployment_label', type: 'text' },
                  { label: 'Rate per Entry (USD)', key: 'deployment_rate', type: 'number' },
                  { label: 'Meetings Unit (e.g. 2)', key: 'meeting_rate_unit', type: 'number' },
                  { label: 'Meetings Rate (USD)', key: 'meeting_rate_value', type: 'number' },
                ].map(({ label, key, type, max }) => (
                  <div key={key} className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-500">{label}</label>
                    <input
                      type={type} maxLength={max}
                      value={(userSettings as any)[key]}
                      onChange={(e) => setUserSettings({ ...userSettings, [key]: type === 'number' ? (key === 'meeting_rate_unit' ? parseInt(e.target.value) || 1 : parseFloat(e.target.value) || 0) : e.target.value })}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                    />
                  </div>
                ))}
              </div>
              <div className="pt-6 flex items-center justify-between">
                {message && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={`flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {message.text}
                  </motion.div>
                )}
                <button type="submit" disabled={saving} className="bg-stone-900 text-white font-bold px-10 py-4 rounded-2xl hover:bg-stone-800 active:scale-95 transition-all shadow-lg shadow-stone-200 flex items-center gap-2 ml-auto">
                  {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
                  Save Settings
                </button>
              </div>
            </form>
          </motion.div>
        </main>
      </div>
    );
  }

  // --- RENDER: Main Dashboard ---
  return (
    <div className="min-h-screen bg-[#F5F5F0] text-stone-900 font-sans selection:bg-stone-200">
      <header className="border-b border-stone-200 bg-white/50 backdrop-blur-md sticky top-0 z-10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-stone-900 p-2 rounded-lg"><FileText className="text-white w-6 h-6" /></div>
            <div>
              <h1 className="text-xl font-serif font-bold tracking-tight">Paycheck Manager</h1>
              <p className="text-xs text-stone-500 uppercase tracking-widest font-semibold capitalize">{currentUser}'s Account</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-stone-600">
            <button onClick={() => { fetchGlobalData(); setShowGlobalOverview(true); }} className="p-2 hover:bg-stone-100 rounded-lg transition-colors" title="Global Overview"><LayoutGrid className="w-5 h-5" /></button>
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-stone-100 rounded-lg transition-colors" title="Settings"><SettingsIcon className="w-5 h-5" /></button>
            <button onClick={handleLogout} className="p-2 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-colors" title="Logout"><LogOut className="w-5 h-5" /></button>
            <div className="h-6 w-px bg-stone-200 mx-2"></div>
            <div className="flex items-center gap-1.5"><Clock className="w-4 h-4" /><span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-emerald-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total Earned</div>
            <div className="text-2xl font-serif font-bold">${(Object.values(invoices) as InvoiceData[]).reduce((sum, inv) => sum + calculateTotal(inv), 0).toFixed(2)}</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-violet-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4"><DollarSign className="w-5 h-5 text-violet-600" /></div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Current Invoice</div>
            <div className="text-2xl font-serif font-bold">${editData ? calculateTotal(editData).toFixed(2) : '0.00'}</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-stone-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4"><FileText className="w-5 h-5 text-stone-600" /></div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Invoices</div>
            <div className="text-2xl font-serif font-bold">{Object.keys(invoices).length}</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-blue-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4"><Clock className="w-5 h-5 text-blue-600" /></div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Next Payment</div>
            <div className="text-sm font-bold truncate">{formatDate(currentPeriod.paymentDate)}</div>
          </div>
        </div>

        {/* Invoice Editor */}
        <div>
          <AnimatePresence mode="wait">
            {selectedPeriod && editData ? (
              <motion.div key={selectedPeriod.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-white rounded-[32px] border border-stone-200 shadow-xl shadow-stone-200/50 overflow-hidden">
                <div className="p-8 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-3xl font-serif font-bold mb-1">Invoice for {selectedPeriod.label}</h2>
                      <p className="text-stone-500 text-sm">Period: {formatDate(selectedPeriod.start)} — {formatDate(selectedPeriod.end)}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total Amount</div>
                      <div className="text-4xl font-serif font-bold text-stone-900">${calculateTotal(editData).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 flex items-center gap-4">
                      <div className="bg-amber-50 p-2.5 rounded-xl"><Calendar className="w-5 h-5 text-amber-600" /></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Payment Date</div><div className="text-sm font-semibold">{formatDate(selectedPeriod.paymentDate)}</div></div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 flex items-center gap-4">
                      <div className="bg-blue-50 p-2.5 rounded-xl"><Clock className="w-5 h-5 text-blue-600" /></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Due Time</div><div className="text-sm font-semibold">11:30 AM CET</div></div>
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3 md:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">{userSettings.deployment_label} (${userSettings.deployment_rate}/ea)</label>
                      <div className="space-y-3">
                        {editData.app_deployments.map(dep => (
                          <div key={dep.id} className="flex items-center gap-2 bg-stone-50 p-2 rounded-lg border border-stone-200">
                            <p className="flex-grow text-sm text-stone-700 px-2">{dep.details}</p>
                            <button onClick={() => handleRemoveDeployment(dep.id)} className="p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"><X className="w-4 h-4" /></button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <input type="text" placeholder={`Enter ${userSettings.deployment_label.toLowerCase()} details...`} disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent} value={newDeployment} onChange={(e) => setNewDeployment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddDeployment()} className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium" />
                        <button onClick={handleAddDeployment} disabled={!newDeployment.trim() || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)} className="px-4 py-3 bg-stone-900 text-white rounded-xl hover:bg-stone-800 disabled:bg-stone-200 disabled:cursor-not-allowed transition-all active:scale-95"><Plus className="w-5 h-5" /></button>
                      </div>
                      <p className="text-[10px] text-stone-400 italic">Subtotal: ${(editData.app_deployments.length * userSettings.deployment_rate).toFixed(2)}</p>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">Meetings (${userSettings.meeting_rate_value} per {userSettings.meeting_rate_unit})</label>
                      <div className="relative">
                        <input type="number" min="0" disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent} value={editData.meetings} onChange={(e) => setEditData({ ...editData, meetings: parseInt(e.target.value) || 0 })} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium" />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">Entries</div>
                      </div>
                      <p className="text-[10px] text-stone-400 italic">Subtotal: ${(Math.floor(editData.meetings / userSettings.meeting_rate_unit) * userSettings.meeting_rate_value).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">Base Rate</label>
                    <div className="relative">
                      <input type="number" min="0" disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent} value={editData.base_rate} onChange={(e) => setEditData({ ...editData, base_rate: parseFloat(e.target.value) || 0 })} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium" />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">USD</div>
                    </div>
                  </div>

                  <div className="space-y-3 md:col-span-2">
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">Custom Entries</label>
                    <div className="space-y-3">
                      {editData.custom_entries.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 bg-stone-50 p-2 rounded-lg border border-stone-200">
                          <p className="flex-grow text-sm text-stone-700 px-2">{entry.description}: ${entry.amount.toFixed(2)}</p>
                          <button onClick={() => handleRemoveCustomEntry(entry.id)} className="p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <input type="text" placeholder="Description" disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent} value={newCustomEntryDescription} onChange={(e) => setNewCustomEntryDescription(e.target.value)} className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium" />
                      <input type="number" min="0" placeholder="Amount" disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent} value={newCustomEntryAmount} onChange={(e) => setNewCustomEntryAmount(parseFloat(e.target.value) || 0)} className="w-24 bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium" />
                      <button onClick={handleAddCustomEntry} disabled={!newCustomEntryDescription.trim() || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)} className="px-4 py-3 bg-stone-900 text-white rounded-xl hover:bg-stone-800 disabled:bg-stone-200 disabled:cursor-not-allowed transition-all active:scale-95"><Plus className="w-5 h-5" /></button>
                    </div>
                  </div>

                  <div className="pt-6 flex items-center justify-between">
                    <div>
                      {message && (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={`flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          {message.text}
                        </motion.div>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {isSaved && (
                        <>
                          <button onClick={handleDeleteInvoice} className="flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 active:scale-95 transition-all"><Trash2 className="w-5 h-5" /></button>
                          <button onClick={handleExport} className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-100"><Download className="w-5 h-5" />Export</button>
                        </>
                      )}
                      <button onClick={handleSave} disabled={saving || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)} className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all ${saving || (selectedPeriod.isFuture && !selectedPeriod.isCurrent) ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-stone-900 text-white hover:bg-stone-800 active:scale-95 shadow-lg shadow-stone-200'}`}>
                        {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
                        {saving ? 'Saving...' : 'Save Invoice'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="px-8 py-4 bg-stone-50 border-t border-stone-100 text-[10px] text-stone-400 flex justify-between uppercase tracking-widest font-bold">
                  <span>Last Updated: {editData.updated_at ? new Date(editData.updated_at).toLocaleString() : 'Never'}</span>
                  <span>Invoice ID: {editData.id}</span>
                </div>
              </motion.div>
            ) : (
              <div className="h-[600px] flex flex-col items-center justify-center text-stone-400 border-2 border-dashed border-stone-200 rounded-[32px]">
                <Calendar className="w-12 h-12 mb-4 opacity-20" />
                <p className="font-serif italic">Select a period to view or edit invoice</p>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Period Selection */}
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-serif text-lg font-semibold">Invoice Periods</h2>
            <div className="flex items-center gap-1 bg-stone-100 border border-stone-200 p-1 rounded-xl">
              {availableYears.map(year => (
                <button key={year} onClick={() => setSelectedYear(year)} className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-all ${selectedYear === year ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:bg-white/50'}`}>{year}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {periods.filter(p => !p.isFuture || p.isCurrent).reverse().map((period) => (
              <button key={period.id} onClick={() => setSelectedPeriodId(period.id)} className={`w-full text-left p-4 rounded-2xl transition-all duration-200 border ${selectedPeriodId === period.id ? 'bg-stone-900 border-stone-900 text-white shadow-lg shadow-stone-200' : 'bg-white border-stone-200 hover:border-stone-400 text-stone-600'}`}>
                <div className="flex flex-col h-full">
                  <div className="flex-grow">
                    <div className="text-xs font-bold uppercase tracking-tighter opacity-60 mb-1">Invoice for {period.label}</div>
                    <div className="font-serif text-base font-medium">{period.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {period.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </div>
                  {period.isCurrent && <span className={`mt-2 self-start px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${selectedPeriodId === period.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>Current</span>}
                </div>
              </button>
            ))}
            {periods.filter(p => p.isFuture && !p.isCurrent).slice(0, 2).map((period) => (
              <div key={period.id} className="w-full text-left p-4 rounded-2xl bg-stone-100 border border-stone-200 opacity-50 cursor-not-allowed">
                <div className="text-xs font-bold uppercase tracking-tighter text-stone-400 mb-1">Invoice for {period.label}</div>
                <div className="font-serif text-base font-medium text-stone-400">Locked until {period.start.toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════
          GLOBAL OVERVIEW MODAL — redesigned
          ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showGlobalOverview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-stone-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="bg-[#F5F5F0] w-full max-w-6xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-white/20">
              
              {/* Header */}
              <div className="p-8 border-b border-stone-200 bg-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                  <div className="bg-stone-900 p-3 rounded-2xl"><Globe className="text-white w-6 h-6" /></div>
                  <div>
                    <h2 className="text-2xl font-serif font-bold">Global Invoice Overview</h2>
                    <p className="text-stone-500 text-sm">All periods · Dimitar + Gordana combined</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {loadingRates && (
                    <div className="flex items-center gap-2 text-xs text-stone-400 font-medium">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fetching historical rates…
                    </div>
                  )}
                  <div className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 text-xs font-bold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    <span>Today: 1 USD = {exchangeRate.toFixed(4)} EUR</span>
                  </div>
                  <button onClick={() => setShowGlobalOverview(false)} className="p-2 hover:bg-stone-100 rounded-full transition-colors"><X className="w-6 h-6" /></button>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="px-8 pt-6 pb-2 shrink-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Total USD all periods */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="bg-stone-100 p-2 rounded-lg"><DollarSign className="w-4 h-4 text-stone-600" /></div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Total (USD)</div>
                    </div>
                    <div className="text-2xl font-serif font-bold">${periodGroups.reduce((s, g) => s + g.totalUsd, 0).toFixed(2)}</div>
                  </div>
                  {/* Total estimated EUR */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="bg-emerald-50 p-2 rounded-lg"><Euro className="w-4 h-4 text-emerald-600" /></div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Est. EUR (at rate)</div>
                    </div>
                    <div className="text-2xl font-serif font-bold text-emerald-700">
                      €{periodGroups.reduce((s, g) => s + (g.estimatedEur ?? 0), 0).toFixed(2)}
                    </div>
                  </div>
                  {/* Total est. received after fees */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="bg-blue-50 p-2 rounded-lg"><TrendingDown className="w-4 h-4 text-blue-600" /></div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Est. After Fees</div>
                    </div>
                    <div className="text-2xl font-serif font-bold text-blue-700">
                      €{periodGroups.reduce((s, g) => s + (g.estimatedReceived ?? 0), 0).toFixed(2)}
                    </div>
                  </div>
                  {/* Total actually received */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="bg-violet-50 p-2 rounded-lg"><Banknote className="w-4 h-4 text-violet-600" /></div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Actually Received</div>
                    </div>
                    <div className="text-2xl font-serif font-bold text-violet-700">
                      €{periodGroups.reduce((s, g) => s + g.totalReceivedEur, 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="flex-grow overflow-y-auto px-8 pb-8 custom-scrollbar mt-4">
                {loading ? (
                  <div className="flex items-center justify-center h-40 text-stone-400">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading invoices…
                  </div>
                ) : periodGroups.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-stone-400 font-serif italic">No invoices found.</div>
                ) : (
                  <div className="bg-white rounded-[28px] border border-stone-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-100">
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Period</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Due Date</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Rate on Due Date</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Total USD</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Est. EUR</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Est. After Fees</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Status</th>
                          <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Received (€)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {periodGroups.map((group) => {
                          const isPastDue = group.paymentDate < new Date();
                          
                          return (
                            <React.Fragment key={group.periodKey}>
                              {/* Main combined row */}
                              <tr className="hover:bg-stone-50/80 transition-colors">
                                {/* Period */}
                                <td className="px-5 py-4">
                                  <div className="font-semibold text-sm">{group.periodLabel}</div>
                                  <div className="text-[10px] text-stone-400 mt-0.5">
                                    {group.invoices.map(inv => (
                                      <span key={inv.id} className={`inline-block mr-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${inv.user_id === 'dimitar' ? 'bg-stone-900 text-white' : 'bg-stone-200 text-stone-600'}`}>
                                        {inv.user_id === 'dimitar' ? 'D' : 'G'} ${calcInvoiceTotal(inv, allUserSettings[inv.user_id])?.toFixed(0) ?? '—'}
                                      </span>
                                    ))}
                                  </div>
                                </td>

                                {/* Due date */}
                                <td className="px-5 py-4">
                                  <div className="text-sm font-medium">{formatShortDate(group.paymentDate)}</div>
                                  {isPastDue && <div className="text-[10px] text-stone-400">Past due</div>}
                                </td>

                                {/* Historical rate */}
                                <td className="px-5 py-4">
                                  {group.historicalRate != null ? (
                                    <div>
                                      <div className="text-sm font-mono font-semibold">{group.historicalRate.toFixed(4)}</div>
                                      <div className="text-[10px] text-stone-400">on due date</div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 text-stone-300">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      <span className="text-xs">fetching</span>
                                    </div>
                                  )}
                                </td>

                                {/* Total USD */}
                                <td className="px-5 py-4">
                                  <div className="font-serif font-bold text-base">${group.totalUsd.toFixed(2)}</div>
                                </td>

                                {/* Estimated EUR at historical rate */}
                                <td className="px-5 py-4">
                                  {group.estimatedEur != null ? (
                                    <div className="font-serif font-bold text-base text-emerald-700">€{group.estimatedEur.toFixed(2)}</div>
                                  ) : (
                                    <span className="text-stone-300 text-sm">—</span>
                                  )}
                                </td>

                                {/* Estimated after fees */}
                                <td className="px-5 py-4">
                                  {group.estimatedReceived != null && !group.allPaid ? (
                                    <div>
                                      <div className="font-serif font-bold text-base text-blue-700">€{group.estimatedReceived.toFixed(2)}</div>
                                      <div className="text-[10px] text-stone-400">est. after fees</div>
                                    </div>
                                  ) : group.allPaid ? (
                                    <span className="text-[10px] text-stone-400 italic">see received →</span>
                                  ) : (
                                    <span className="text-stone-300 text-sm">—</span>
                                  )}
                                </td>

                                {/* Status — toggle each individual invoice */}
                                <td className="px-5 py-4">
                                  <div className="flex flex-col gap-1">
                                    {group.invoices.map(inv => (
                                      <button
                                        key={inv.id}
                                        onClick={() => handleUpdatePaymentStatus(inv.id, !inv.is_paid, inv.received_amount_eur || 0)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all w-fit ${inv.is_paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                                      >
                                        {inv.is_paid ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                        <span className={`inline-block w-3 h-3 rounded-full mr-0.5 ${inv.user_id === 'dimitar' ? 'bg-stone-800' : 'bg-stone-400'}`}></span>
                                        {inv.user_id === 'dimitar' ? 'Dim' : 'Gor'}: {inv.is_paid ? 'Paid' : 'Pending'}
                                      </button>
                                    ))}
                                  </div>
                                </td>

                                {/* Received EUR — one input per invoice */}
                                <td className="px-5 py-4">
                                  <div className="flex flex-col gap-2">
                                    {group.invoices.map(inv => (
                                      <div key={inv.id} className="flex items-center gap-1.5">
                                        <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${inv.user_id === 'dimitar' ? 'bg-stone-900 text-white' : 'bg-stone-200 text-stone-600'}`}>
                                          {inv.user_id === 'dimitar' ? 'D' : 'G'}
                                        </span>
                                        {inv.is_paid ? (
                                          <>
                                            <span className="text-stone-400 text-xs">€</span>
                                            <input
                                              type="number"
                                              value={inv.received_amount_eur || 0}
                                              onChange={(e) => handleUpdatePaymentStatus(inv.id, true, parseFloat(e.target.value) || 0)}
                                              className="w-20 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-xs font-bold focus:ring-1 focus:ring-stone-900 outline-none"
                                            />
                                          </>
                                        ) : (
                                          <span className="text-stone-300 text-xs italic">unpaid</span>
                                        )}
                                      </div>
                                    ))}
                                    {/* Combined received total if both paid */}
                                    {group.invoices.length > 1 && group.anyPaid && (
                                      <div className="mt-1 pt-1 border-t border-stone-100">
                                        <div className="text-[10px] text-stone-500 font-bold">Total: €{group.totalReceivedEur.toFixed(2)}</div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-stone-200 bg-white flex justify-between items-center shrink-0">
                <div className="text-stone-400 text-xs italic">
                  * EUR amounts use the historical rate on each invoice's due date. Fee estimates are derived from past paid invoices.
                </div>
                <button onClick={() => setShowGlobalOverview(false)} className="bg-stone-900 text-white font-bold px-8 py-3 rounded-2xl hover:bg-stone-800 transition-all">
                  Close Overview
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E5E0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D1D1CB; }
      `}} />
    </div>
  );
}
