import React, { useState, useEffect, useMemo } from 'react';
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
  CreditCard
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

// --- Constants (Defaults) ---
const DEFAULT_MEETING_RATE_UNIT = 2;
const DEFAULT_MEETING_RATE_VALUE = 5;

// --- Helpers ---

const getPaymentDate = (periodEndDate: Date): Date => {
  const date = new Date(periodEndDate);
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  
  if (day === 0) { // Sunday -> Friday
    date.setDate(date.getDate() - 2);
  } else if (day === 6) { // Saturday -> Friday
    date.setDate(date.getDate() - 1);
  }
  
  // Set time to 11:30 AM CET
  // Note: CET is UTC+1. In summer (CEST) it's UTC+2. 
  // For simplicity, we'll just show the string "11:30 AM CET" in UI as requested.
  return date;
};

const generatePeriods = (targetYear: number): Period[] => {
  const now = new Date();
  const periods: Period[] = [];
  
  const year = targetYear;

    for (let month = 0; month < 12; month++) {
      // Period 1: 1st to 14th
      const p1Start = new Date(year, month, 1);
      const p1End = new Date(year, month, 14);
      
      // Period 2: 15th to end of month
      const p2Start = new Date(year, month, 15);
      const p2End = new Date(year, month + 1, 0); // Last day of month

      [
        { start: p1Start, end: p1End },
        { start: p2Start, end: p2End }
      ].forEach(({ start, end }) => {
        const id = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
        const label = `${start.getMonth() + 1}.${start.getDate()}-${end.getMonth() + 1}.${end.getDate()}`;
        
        const isFuture = start > now;
        const isCurrent = now >= start && now <= end;

        periods.push({
          id,
          label,
          start,
          end,
          paymentDate: getPaymentDate(end), // Use the period's end date
          isFuture,
          isCurrent
        });
      });
    }
  
  return periods;
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

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Record<string, InvoiceData>>({});
  const [allInvoices, setAllInvoices] = useState<InvoiceData[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(0.95);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Current editing state
  const [editData, setEditData] = useState<InvoiceData | null>(null);
  const [newDeployment, setNewDeployment] = useState('');
  const [newCustomEntryDescription, setNewCustomEntryDescription] = useState('');
  const [newCustomEntryAmount, setNewCustomEntryAmount] = useState<number>(0);

  const currentPeriod = useMemo(() => {
    return periods.find(p => p.isCurrent) || periods[0];
  }, [periods]);

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

  const fetchGlobalData = async () => {
    setLoading(true);
    try {
      const [invRes, rateRes, dimitarSettings, gordanaSettings] = await Promise.all([
        fetch('/api/all-invoices'),
        fetch('/api/exchange-rate'),
        fetch('/api/settings/dimitar'),
        fetch('/api/settings/gordana')
      ]);
      
      const invoicesData = await invRes.json();
      const rateData = await rateRes.json();
      const dimSettings = await dimitarSettings.json();
      const gorSettings = await gordanaSettings.json();

      setAllInvoices(invoicesData);
      setExchangeRate(rateData.rate);
      setAllUserSettings({
        dimitar: dimSettings,
        gordana: gorSettings
      });
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
      const map = data.reduce((acc, inv) => ({ ...acc, [inv.id]: inv }), {});
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
    // Pre-fetch settings to get the PIN
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
    const customEntriesTotal = editData.custom_entries.reduce((sum, entry) => sum + entry.amount, 0);

    let tableHtml = `
      <style>
        body { font-family: sans-serif; margin: 2em; }
        table { border-collapse: collapse; width: 100%; max-width: 600px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:last-child td { font-weight: bold; }
      </style>
      <h2>Invoice for ${selectedPeriod.label}</h2>
      <table>
        <tr><td>Payment period</td><td>${selectedPeriod.label}</td></tr>
    `;

    editData.app_deployments.forEach(dep => {
      tableHtml += `<tr><td>${dep.details}</td><td>${userSettings.deployment_rate.toFixed(2)}</td></tr>`;
    });

    editData.custom_entries.forEach(entry => {
      tableHtml += `<tr><td>${entry.description}</td><td>${entry.amount.toFixed(2)}</td></tr>`;
    });

    tableHtml += `
        <tr><td>Meetings (${editData.meetings} in total, ${userSettings.meeting_rate_unit}x${userSettings.meeting_rate_value/userSettings.meeting_rate_unit}USD)</td><td>${meetingSubtotal.toFixed(2)}</td></tr>
        <tr><td>Base rate</td><td>${editData.base_rate.toFixed(2)}</td></tr>
        <tr><td>Total in USD</td><td>${total.toFixed(2)}</td></tr>
      </table>
    `;

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(tableHtml);
      newWindow.document.close();
    }
  };

  useEffect(() => {
    if (selectedPeriod && userSettings && currentUser) {
      const existing = invoices[selectedPeriod.id];
      setEditData(existing || {
        id: selectedPeriod.id,
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

  const handleUpdatePaymentStatus = async (id: string, isPaid: boolean, receivedEur: number) => {
    try {
      const res = await fetch(`/api/invoices/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_paid: isPaid, received_amount_eur: receivedEur })
      });
      if (res.ok) {
        setAllInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, is_paid: isPaid, received_amount_eur: receivedEur } : inv));
        // Also update local invoices if it matches current user
        if (invoices[id]) {
          setInvoices(prev => ({ ...prev, [id]: { ...prev[id], is_paid: isPaid, received_amount_eur: receivedEur } }));
        }
      }
    } catch (err) {
      console.error("Failed to update payment status", err);
    }
  };

  const handleAddDeployment = () => {
    if (newDeployment.trim() && editData && userSettings) {
      const deploymentDetails = newDeployment.trim();
      
      // Check for duplicates in ALL invoices
      const allExistingDeployments = Object.values(invoices).flatMap((invoice: InvoiceData) => 
        invoice.app_deployments.map(dep => dep.details.toLowerCase())
      );
      
      // Check for duplicates in CURRENT unsaved list
      const currentDeployments = editData.app_deployments.map(dep => dep.details.toLowerCase());

      if (allExistingDeployments.includes(deploymentDetails.toLowerCase()) || 
          currentDeployments.includes(deploymentDetails.toLowerCase())) {
        setMessage({ type: 'error', text: `Warning: This ${userSettings.deployment_label.toLowerCase()} is a duplicate. Added anyway.` });
        setTimeout(() => setMessage(null), 4000);
      }

      const newEntry: AppDeployment = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        details: deploymentDetails,
      };
      setEditData({ ...editData, app_deployments: [...editData.app_deployments, newEntry] });
      setNewDeployment('');
    }
  };

  const handleAddCustomEntry = () => {
    if (newCustomEntryDescription.trim() && editData) {
      const newEntry: CustomEntry = {
        id: Date.now().toString(),
        description: newCustomEntryDescription.trim(),
        amount: newCustomEntryAmount,
      };
      setEditData({ ...editData, custom_entries: [...editData.custom_entries, newEntry] });
      setNewCustomEntryDescription('');
      setNewCustomEntryAmount(0);
    }
  };

  const handleRemoveCustomEntry = (id: string) => {
    if (editData) {
      setEditData({ 
        ...editData, 
        custom_entries: editData.custom_entries.filter(e => e.id !== id) 
      });
    }
  };

  const handleRemoveDeployment = (id: string) => {
    if (editData) {
      setEditData({ 
        ...editData, 
        app_deployments: editData.app_deployments.filter(d => d.id !== id) 
      });
    }
  };

  const handleDeleteInvoice = async () => {
    if (!selectedPeriod || !invoices[selectedPeriod.id]) return;
    
    if (!confirm("Are you sure you want to delete this entire invoice? This cannot be undone.")) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${selectedPeriod.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setInvoices(prev => {
          const next = { ...prev };
          delete next[selectedPeriod.id];
          return next;
        });
        setMessage({ type: 'success', text: 'Invoice deleted successfully.' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        throw new Error("Failed to delete");
      }
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
        setInvoices(prev => ({ ...prev, [editData.id]: editData }));
        setMessage({ type: 'success', text: 'Invoice saved successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        throw new Error("Failed to save");
      }
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
      } else {
        throw new Error("Failed to save settings");
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[40px] border border-stone-200 shadow-2xl p-10 text-center"
        >
          <div className="bg-stone-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-serif font-bold mb-2">Welcome</h1>
          <p className="text-stone-500 mb-10">Select your account to continue</p>
          
          <div className="grid grid-cols-1 gap-4">
            <button 
              onClick={() => handleUserSelect('dimitar')}
              className="flex items-center justify-between p-6 bg-stone-50 hover:bg-stone-100 rounded-3xl border border-stone-200 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="bg-stone-900 text-white p-3 rounded-xl group-hover:scale-110 transition-transform">
                  <UserIcon className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Dimitar</div>
                  <div className="text-xs text-stone-400 uppercase tracking-widest font-bold">Account Holder</div>
                </div>
              </div>
              <ChevronRight className="text-stone-300 group-hover:translate-x-1 transition-transform" />
            </button>
            <button 
              onClick={() => handleUserSelect('gordana')}
              className="flex items-center justify-between p-6 bg-stone-50 hover:bg-stone-100 rounded-3xl border border-stone-200 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="bg-stone-900 text-white p-3 rounded-xl group-hover:scale-110 transition-transform">
                  <UserIcon className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Gordana</div>
                  <div className="text-xs text-stone-400 uppercase tracking-widest font-bold">Account Holder</div>
                </div>
              </div>
              <ChevronRight className="text-stone-300 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[40px] border border-stone-200 shadow-2xl p-10 text-center"
        >
          <button 
            onClick={() => setCurrentUser(null)}
            className="absolute top-8 left-8 p-2 text-stone-400 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          
          <div className="bg-stone-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Lock className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-serif font-bold mb-2 capitalize">{currentUser}</h1>
          <p className="text-stone-500 mb-10">Enter your 4-digit PIN</p>
          
          <form onSubmit={handlePinSubmit} className="space-y-6">
            <input 
              type="password"
              maxLength={4}
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              className="w-full text-center text-4xl tracking-[1em] font-bold bg-stone-50 border border-stone-200 rounded-2xl py-6 focus:ring-2 focus:ring-stone-900 outline-none transition-all"
              placeholder="••••"
            />
            {message && (
              <p className="text-rose-600 text-sm font-bold">{message.text}</p>
            )}
            <button 
              type="submit"
              className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 active:scale-95 transition-all shadow-lg shadow-stone-200"
            >
              Unlock Account
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (showSettings && userSettings) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] text-stone-900 font-sans">
        <header className="border-b border-stone-200 bg-white/50 backdrop-blur-md sticky top-0 z-10 px-6 py-4">
          <div className="max-w-3xl mx-auto flex justify-between items-center">
            <button 
              onClick={() => setShowSettings(false)}
              className="flex items-center gap-2 text-stone-500 hover:text-stone-900 font-bold transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Dashboard
            </button>
            <h1 className="text-xl font-serif font-bold">Settings</h1>
            <div className="w-20"></div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[32px] border border-stone-200 shadow-xl p-8 space-y-10"
          >
            <form onSubmit={handleSaveSettings} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Account PIN</label>
                  <input 
                    type="text"
                    maxLength={4}
                    value={userSettings.pin}
                    onChange={(e) => setUserSettings({...userSettings, pin: e.target.value})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Base Rate (USD)</label>
                  <input 
                    type="number"
                    value={userSettings.base_rate}
                    onChange={(e) => setUserSettings({...userSettings, base_rate: parseFloat(e.target.value) || 0})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Deployment Label</label>
                  <input 
                    type="text"
                    value={userSettings.deployment_label}
                    onChange={(e) => setUserSettings({...userSettings, deployment_label: e.target.value})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Rate per Entry (USD)</label>
                  <input 
                    type="number"
                    value={userSettings.deployment_rate}
                    onChange={(e) => setUserSettings({...userSettings, deployment_rate: parseFloat(e.target.value) || 0})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Meetings Unit (e.g. 2)</label>
                  <input 
                    type="number"
                    value={userSettings.meeting_rate_unit}
                    onChange={(e) => setUserSettings({...userSettings, meeting_rate_unit: parseInt(e.target.value) || 1})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Meetings Rate (USD)</label>
                  <input 
                    type="number"
                    value={userSettings.meeting_rate_value}
                    onChange={(e) => setUserSettings({...userSettings, meeting_rate_value: parseFloat(e.target.value) || 0})}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 outline-none transition-all font-bold"
                  />
                </div>
              </div>

              <div className="pt-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {message && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}
                    >
                      {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {message.text}
                    </motion.div>
                  )}
                </div>
                <button 
                  type="submit"
                  disabled={saving}
                  className="bg-stone-900 text-white font-bold px-10 py-4 rounded-2xl hover:bg-stone-800 active:scale-95 transition-all shadow-lg shadow-stone-200 flex items-center gap-2"
                >
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

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-stone-900 font-sans selection:bg-stone-200">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/50 backdrop-blur-md sticky top-0 z-10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-stone-900 p-2 rounded-lg">
              <FileText className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-serif font-bold tracking-tight">Paycheck Manager</h1>
              <p className="text-xs text-stone-500 uppercase tracking-widest font-semibold capitalize">{currentUser}'s Account</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-stone-600">
            <button 
              onClick={() => {
                fetchGlobalData();
                setShowGlobalOverview(true);
              }}
              className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              title="Global Overview"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              title="Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-stone-200 mx-2"></div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">

        {/* Top Section: Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-emerald-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total Earned</div>
            <div className="text-2xl font-serif font-bold">
              ${(Object.values(invoices) as InvoiceData[]).reduce((sum: number, inv: InvoiceData): number => sum + calculateTotal(inv), 0).toFixed(2)}
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-violet-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
                <DollarSign className="w-5 h-5 text-violet-600" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Current Invoice</div>
            <div className="text-2xl font-serif font-bold">
                ${editData ? calculateTotal(editData).toFixed(2) : '0.00'}
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-stone-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <FileText className="w-5 h-5 text-stone-600" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Invoices</div>
            <div className="text-2xl font-serif font-bold">{Object.keys(invoices).length}</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="bg-blue-50 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Next Payment</div>
            <div className="text-sm font-bold truncate">
              {formatDate(currentPeriod.paymentDate)}
            </div>
          </div>
        </div>

        {/* Middle Section: Invoice Editor */}
        <div>
          <AnimatePresence mode="wait">
            {selectedPeriod && editData ? (
              <motion.div
                key={selectedPeriod.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white rounded-[32px] border border-stone-200 shadow-xl shadow-stone-200/50 overflow-hidden"
              >
                {/* Invoice Header */}
                <div className="p-8 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-3xl font-serif font-bold mb-1">Invoice for {selectedPeriod.label}</h2>
                      <p className="text-stone-500 text-sm">Period: {formatDate(selectedPeriod.start)} — {formatDate(selectedPeriod.end)}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total Amount</div>
                      <div className="text-4xl font-serif font-bold text-stone-900">
                        ${calculateTotal(editData).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 flex items-center gap-4">
                      <div className="bg-amber-50 p-2.5 rounded-xl">
                        <Calendar className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Payment Date</div>
                        <div className="text-sm font-semibold">{formatDate(selectedPeriod.paymentDate)}</div>
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 flex items-center gap-4">
                      <div className="bg-blue-50 p-2.5 rounded-xl">
                        <Clock className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Due Time</div>
                        <div className="text-sm font-semibold">11:30 AM CET</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Form Body */}
                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* App Deployments / Marketings */}
                    <div className="space-y-3 md:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">
                        {userSettings.deployment_label} (${userSettings.deployment_rate}/ea)
                      </label>
                      
                      <div className="space-y-3">
                        {editData.app_deployments.map(dep => (
                          <div key={dep.id} className="flex items-center gap-2 bg-stone-50 p-2 rounded-lg border border-stone-200">
                            <p className="flex-grow text-sm text-stone-700 px-2">{dep.details}</p>
                            <button 
                              onClick={() => handleRemoveDeployment(dep.id)}
                              className="p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="text"
                          placeholder={`Enter ${userSettings.deployment_label.toLowerCase()} details...`}
                          disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent}
                          value={newDeployment}
                          onChange={(e) => setNewDeployment(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddDeployment()}
                          className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium"
                        />
                        <button 
                          onClick={handleAddDeployment}
                          disabled={!newDeployment.trim() || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)}
                          className="px-4 py-3 bg-stone-900 text-white rounded-xl hover:bg-stone-800 disabled:bg-stone-200 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-400 italic">Subtotal: ${(editData.app_deployments.length * userSettings.deployment_rate).toFixed(2)}</p>
                    </div>

                    {/* Meetings */}
                    <div className="space-y-3">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">
                        Meetings (${userSettings.meeting_rate_value} per {userSettings.meeting_rate_unit})
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent}
                          value={editData.meetings}
                          onChange={(e) => setEditData({ ...editData, meetings: parseInt(e.target.value) || 0 })}
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">
                          Entries
                        </div>
                      </div>
                      <p className="text-[10px] text-stone-400 italic">Subtotal: ${(Math.floor(editData.meetings / userSettings.meeting_rate_unit) * userSettings.meeting_rate_value).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">
                        Base Rate
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent}
                          value={editData.base_rate}
                          onChange={(e) => setEditData({ ...editData, base_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">
                          USD
                        </div>
                      </div>
                    </div>

                    {/* Custom Entries */}
                    <div className="space-y-3 md:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">
                        Custom Entries
                      </label>

                      <div className="space-y-3">
                        {editData.custom_entries.map(entry => (
                          <div key={entry.id} className="flex items-center gap-2 bg-stone-50 p-2 rounded-lg border border-stone-200">
                            <p className="flex-grow text-sm text-stone-700 px-2">{entry.description}: ${entry.amount.toFixed(2)}</p>
                            <button 
                              onClick={() => handleRemoveCustomEntry(entry.id)}
                              className="p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="text"
                          placeholder="Description"
                          disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent}
                          value={newCustomEntryDescription}
                          onChange={(e) => setNewCustomEntryDescription(e.target.value)}
                          className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium"
                        />
                        <input
                          type="number"
                          min="0"
                          placeholder="Amount"
                          disabled={selectedPeriod.isFuture && !selectedPeriod.isCurrent}
                          value={newCustomEntryAmount}
                          onChange={(e) => setNewCustomEntryAmount(parseFloat(e.target.value) || 0)}
                          className="w-24 bg-white border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none transition-all font-medium"
                        />
                        <button 
                          onClick={handleAddCustomEntry}
                          disabled={!newCustomEntryDescription.trim() || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)}
                          className="px-4 py-3 bg-stone-900 text-white rounded-xl hover:bg-stone-800 disabled:bg-stone-200 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                  {/* Actions */}
                  <div className="pt-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {message && (
                        <motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}
                        >
                          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          {message.text}
                        </motion.div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4">
                    {isSaved && (
                        <>
                          <button
                            onClick={handleDeleteInvoice}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 active:scale-95 transition-all"
                            title="Delete this invoice"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={handleExport}
                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-100"
                          >
                            <Download className="w-5 h-5" />
                            Export
                          </button>
                        </>
                    )}
                    <button
                      onClick={handleSave}
                      disabled={saving || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)}
                      className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all ${
                        saving || (selectedPeriod.isFuture && !selectedPeriod.isCurrent)
                          ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                          : 'bg-stone-900 text-white hover:bg-stone-800 active:scale-95 shadow-lg shadow-stone-200'
                      }`}
                    >
                      {saving ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Save className="w-5 h-5" />
                      )}
                      {saving ? 'Saving...' : 'Save Invoice'}
                    </button>
                   </div>
                  </div>
                </div>

                {/* Footer Info */}
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

        {/* Bottom Section: Period Selection */}
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-serif text-lg font-semibold">Invoice Periods</h2>
            <div className="flex items-center gap-1 bg-stone-100 border border-stone-200 p-1 rounded-xl">
                {availableYears.map(year => (
                    <button
                        key={year}
                        onClick={() => setSelectedYear(year)}
                        className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-all ${
                            selectedYear === year
                                ? 'bg-white text-stone-900 shadow-sm'
                                : 'text-stone-500 hover:bg-white/50'
                        }`}
                    >
                        {year}
                    </button>
                ))}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {periods.filter(p => !p.isFuture || p.isCurrent).reverse().map((period) => (
              <button
                key={period.id}
                onClick={() => setSelectedPeriodId(period.id)}
                className={`w-full text-left p-4 rounded-2xl transition-all duration-200 border ${
                  selectedPeriodId === period.id 
                    ? 'bg-stone-900 border-stone-900 text-white shadow-lg shadow-stone-200' 
                    : 'bg-white border-stone-200 hover:border-stone-400 text-stone-600'
                }`}
              >
                <div className="flex flex-col h-full">
                  <div className="flex-grow">
                    <div className="text-xs font-bold uppercase tracking-tighter opacity-60 mb-1">
                      Invoice for {period.label}
                    </div>
                    <div className="font-serif text-base font-medium">
                      {period.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {period.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  {period.isCurrent && (
                    <span className={`mt-2 self-start px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${selectedPeriodId === period.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      Current
                    </span>
                  )}
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

      {/* Global Overview Modal */}
      <AnimatePresence>
        {showGlobalOverview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-stone-900/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#F5F5F0] w-full max-w-6xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-white/20"
            >
              <div className="p-8 border-b border-stone-200 bg-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="bg-stone-900 p-3 rounded-2xl">
                    <Globe className="text-white w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-serif font-bold">Global Invoice Overview</h2>
                    <p className="text-stone-500 text-sm">Consolidated view of all accounts and years</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 text-xs font-bold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    <span>Rate: 1 USD = {exchangeRate.toFixed(4)} EUR</span>
                  </div>
                  <button 
                    onClick={() => setShowGlobalOverview(false)}
                    className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="flex-grow overflow-y-auto p-8 custom-scrollbar">
                <div className="grid grid-cols-1 gap-8">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total USD (All)</div>
                      <div className="text-3xl font-serif font-bold">
                        ${allInvoices.reduce((sum, inv) => sum + calculateTotal(inv, allUserSettings[inv.user_id]), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total EUR (Estimated)</div>
                      <div className="text-3xl font-serif font-bold text-emerald-600">
                        €{(allInvoices.reduce((sum, inv) => sum + calculateTotal(inv, allUserSettings[inv.user_id]), 0) * exchangeRate).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total EUR (Received)</div>
                      <div className="text-3xl font-serif font-bold text-blue-600">
                        €{allInvoices.reduce((sum, inv) => sum + (inv.received_amount_eur || 0), 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Invoices Table */}
                  <div className="bg-white rounded-[32px] border border-stone-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-50 text-[10px] font-bold uppercase tracking-widest text-stone-400 border-b border-stone-100">
                          <th className="px-6 py-4">User</th>
                          <th className="px-6 py-4">Period</th>
                          <th className="px-6 py-4">Amount (USD)</th>
                          <th className="px-6 py-4">Amount (EUR)</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4">Received (EUR)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {allInvoices.map((inv) => {
                          const totalUsd = calculateTotal(inv, allUserSettings[inv.user_id]);
                          const totalEur = totalUsd * exchangeRate;
                          const isPaid = inv.is_paid || false;
                          
                          return (
                            <tr key={inv.id} className="hover:bg-stone-50/50 transition-colors">
                              <td className="px-6 py-4">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${inv.user_id === 'dimitar' ? 'bg-stone-900 text-white' : 'bg-stone-200 text-stone-700'}`}>
                                  {inv.user_id}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-sm font-medium">{inv.id.split('-').slice(1).join('.')}</div>
                                <div className="text-[10px] text-stone-400">{new Date(inv.period_start).getFullYear()}</div>
                              </td>
                              <td className="px-6 py-4 font-serif font-bold">${totalUsd.toFixed(2)}</td>
                              <td className="px-6 py-4 font-serif font-bold text-stone-400">€{totalEur.toFixed(2)}</td>
                              <td className="px-6 py-4">
                                <button 
                                  onClick={() => handleUpdatePaymentStatus(inv.id, !isPaid, inv.received_amount_eur || 0)}
                                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                                >
                                  {isPaid ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                  {isPaid ? 'Paid' : 'Pending'}
                                </button>
                              </td>
                              <td className="px-6 py-4">
                                {isPaid ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-stone-400 text-xs">€</span>
                                    <input 
                                      type="number"
                                      value={inv.received_amount_eur || 0}
                                      onChange={(e) => handleUpdatePaymentStatus(inv.id, true, parseFloat(e.target.value) || 0)}
                                      className="w-20 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-xs font-bold focus:ring-1 focus:ring-stone-900 outline-none"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-stone-300 text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              
              <div className="p-8 border-t border-stone-200 bg-white flex justify-between items-center">
                <div className="text-stone-400 text-xs italic">
                  * EUR amounts are calculated using real-time exchange rates.
                </div>
                <button 
                  onClick={() => setShowGlobalOverview(false)}
                  className="bg-stone-900 text-white font-bold px-8 py-3 rounded-2xl hover:bg-stone-800 transition-all"
                >
                  Close Overview
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E5E0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D1CB;
        }
      `}} />
    </div>
  );
}
