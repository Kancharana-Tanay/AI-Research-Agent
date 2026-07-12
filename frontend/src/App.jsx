import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { spawnResearchTask, fetchResearchTask, listResearchTasks } from './services/api';
import {
  Search,
  TrendingUp,
  AlertTriangle,
  Award,
  Activity,
  CheckCircle,
  Clock,
  AlertCircle,
  History,
  BookOpen,
  Layers,
  RefreshCw,
  ChevronRight,
  ThumbsUp,
  FileText
} from 'lucide-react';

export default function App() {
  const queryClient = useQueryClient();
  const [companyInput, setCompanyInput] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [pollingTaskId, setPollingTaskId] = useState(null);

  // 1. Fetch History List
  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['tasks'],
    queryFn: listResearchTasks,
    refetchInterval: 15000 // Refresh list every 15s to capture updates
  });

  // 2. Fetch Selected Task Details
  const { data: taskDetailsData, refetch: refetchDetails } = useQuery({
    queryKey: ['task', selectedTaskId],
    queryFn: () => fetchResearchTask(selectedTaskId),
    enabled: !!selectedTaskId
  });

  const selectedTask = taskDetailsData?.data;

  // 3. Poll Active Spawning Task
  const { data: pollingTaskData } = useQuery({
    queryKey: ['task', pollingTaskId],
    queryFn: () => fetchResearchTask(pollingTaskId),
    enabled: !!pollingTaskId,
    refetchInterval: (query) => {
      const status = query?.state?.data?.data?.status;
      if (status === 'completed' || status === 'failed') {
        // Stop polling once finished
        setPollingTaskId(null);
        refetchHistory();
        return false;
      }
      return 2000; // Poll every 2s
    }
  });

  // Automatically load the polling task details when it completes
  useEffect(() => {
    if (pollingTaskData?.data) {
      const task = pollingTaskData.data;
      if (task.status === 'completed' || task.status === 'failed') {
        setSelectedTaskId(task._id);
        refetchHistory();
      }
    }
  }, [pollingTaskData, refetchHistory]);

  // 4. Spawn Research Task Mutation
  const spawnMutation = useMutation({
    mutationFn: spawnResearchTask,
    onSuccess: (data) => {
      setCompanyInput('');
      refetchHistory();
      if (data?.data?.status === 'pending') {
        setPollingTaskId(data.data.id);
        setSelectedTaskId(data.data.id); // View loading screen immediately
      } else {
        // Cache Hit path (directly completed)
        setSelectedTaskId(data?.data?._id);
      }
    },
    onError: (error) => {
      alert(error.response?.data?.message || 'Failed to spawn research task.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!companyInput.trim()) return;
    spawnMutation.mutate(companyInput.trim());
  };

  const tasksList = historyData?.data || [];

  return (
    <div className="h-screen bg-[#070a13] text-[#f1f5f9] flex flex-col antialiased overflow-hidden">
      {/* Header */}
      <header className="glass-panel sticky top-0 z-50 border-b border-slate-800/80 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-sky-500 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-sky-500/20">
            <Layers className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white m-0 leading-none">Antigravity Research</h1>
            <p className="text-xs text-sky-400 mt-1 m-0">AI-Powered Multi-Agent Investment Broker</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center space-x-2 max-w-md w-full">
          <div className="relative w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              placeholder="Search company (e.g. Apple, Tesla, AAPL)..."
              className="w-full bg-slate-950/80 border border-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm text-white rounded-xl pl-10 pr-4 py-2.5 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={spawnMutation.isPending || !!pollingTaskId}
            className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-sm font-semibold rounded-xl px-5 py-2.5 shadow-lg shadow-sky-500/10 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center space-x-2 shrink-0"
          >
            {spawnMutation.isPending || !!pollingTaskId ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <span>Analyze</span>
            )}
          </button>
        </form>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Task History */}
        <aside className="w-80 border-r border-slate-800/80 bg-slate-950/40 flex flex-col shrink-0 overflow-y-hidden">
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-slate-400 text-sm font-semibold uppercase tracking-wider">
              <History className="h-4 w-4" />
              <span>Research History</span>
            </div>
            <button
              onClick={() => refetchHistory()}
              className="p-1 hover:bg-slate-800/60 rounded text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {historyLoading ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : tasksList.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-10 px-4">
                No research records found. Start by entering a company name above.
              </div>
            ) : (
              tasksList.map((task) => {
                const isSelected = selectedTaskId === task._id;
                const isProcessing = task.status === 'pending' || task.status === 'processing';
                const decision = task.recommendation?.decision;

                return (
                  <button
                    key={task._id}
                    onClick={() => setSelectedTaskId(task._id)}
                    className={`w-full text-left p-3.5 rounded-xl border flex flex-col transition-all text-slate-300 hover:text-white ${isSelected
                      ? 'bg-slate-800/60 border-sky-500/80 text-white shadow-md'
                      : 'bg-slate-900/30 border-slate-800/40 hover:bg-slate-900/50 hover:border-slate-700/50'
                      }`}
                  >
                    <div className="flex justify-between items-start w-full">
                      <div className="font-semibold text-sm truncate max-w-[150px]">
                        {task.company}
                      </div>
                      {isProcessing ? (
                        <span className="flex items-center space-x-1 text-sky-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                          <span>Running</span>
                        </span>
                      ) : task.status === 'failed' ? (
                        <span className="text-rose-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                          Failed
                        </span>
                      ) : (
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${decision === 'BUY'
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : decision === 'HOLD'
                            ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                            : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
                          }`}>
                          {decision || 'COMPLETED'}
                        </span>
                      )}
                    </div>

                    <div className="flex justify-between items-center w-full mt-2.5 text-[11px] text-slate-500">
                      <span className="font-mono">{task.ticker || 'Pending...'}</span>
                      <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-scroll bg-[#070a13] p-6">
          {!selectedTask ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
              <Layers className="h-16 w-16 text-slate-700 animate-pulse mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">No Active Dossier Selected</h2>
              <p className="text-slate-500 text-sm">
                Select a completed report from the history sidebar on the left, or input a new company query above to trigger the multi-agent execution pipeline.
              </p>
            </div>
          ) : selectedTask.status === 'pending' || selectedTask.status === 'processing' ? (
            /* Active Progress Screen */
            <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto py-10">
              <div className="relative mb-6">
                <div className="h-20 w-20 rounded-full border border-sky-500/30 flex items-center justify-center pulse-sky">
                  <Activity className="h-8 w-8 text-sky-400 animate-pulse" />
                </div>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">Analyzing {selectedTask.company}...</h2>
              <p className="text-sm text-slate-400 text-center mb-10">
                Our multi-agent broker is executing ticker search, statement fetching, indicators mapping, and investment evaluation. This takes approximately 8-15 seconds.
              </p>

              {/* Process Checklist */}
              <div className="w-full bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 space-y-4 font-medium text-sm">
                <div className="flex items-center space-x-3 text-emerald-400">
                  <CheckCircle className="h-5 w-5 shrink-0" />
                  <span>Ticker search & resolution validation</span>
                </div>
                <div className="flex items-center space-x-3 text-emerald-400">
                  <CheckCircle className="h-5 w-5 shrink-0" />
                  <span>Fetch profile, technical indicators & news feeds</span>
                </div>
                <div className="flex items-center space-x-3 text-sky-400">
                  <RefreshCw className="h-5 w-5 animate-spin shrink-0" />
                  <span>LLM data sufficiency checks and evidence loop</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-600">
                  <Clock className="h-5 w-5 shrink-0" />
                  <span>Execute quantitative SWOT evaluations</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-600">
                  <Clock className="h-5 w-5 shrink-0" />
                  <span>Draft report summaries, Markdown, and CSS HTML output</span>
                </div>
              </div>
            </div>
          ) : selectedTask.status === 'failed' ? (
            /* Error Failure Screen */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <AlertCircle className="h-16 w-16 text-rose-500 mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Research Run Failed</h2>
              <p className="text-sm text-slate-400 mb-6">{selectedTask.error || 'Unknown pipeline compilation error.'}</p>
              <button
                onClick={() => spawnMutation.mutate(selectedTask.company)}
                className="bg-slate-900 border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-sm font-semibold rounded-xl px-5 py-2.5 transition-all text-white"
              >
                Retry Execution Run
              </button>
            </div>
          ) : (
            /* Completed Active Dashboard */
            <div className="space-y-6 max-w-7xl mx-auto pb-10">

              {/* Hero Header Card */}
              <div className="glass-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div>
                  <div className="flex items-center space-x-3">
                    <span className="bg-sky-500/10 border border-sky-500/20 text-sky-400 font-mono text-xs font-semibold rounded-md px-2 py-0.5 uppercase">
                      {selectedTask.research?.profile?.exchange || 'NASDAQ'}
                    </span>
                    <span className="text-slate-500 font-mono text-sm">{selectedTask.ticker}</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white mt-1 leading-tight">{selectedTask.research?.profile?.name || selectedTask.company}</h2>
                  <p className="text-slate-400 text-sm mt-1.5 max-w-3xl leading-relaxed line-clamp-2">
                    {selectedTask.research?.profile?.description}
                  </p>
                </div>

                {/* Attractiveness Gauge */}
                <div className="flex items-center space-x-4 border-l md:border-l border-slate-800/80 md:pl-6 shrink-0">
                  <div className="relative h-20 w-20 flex items-center justify-center">
                    <svg className="absolute transform -rotate-90 w-full h-full">
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        className="stroke-slate-800"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        className="stroke-sky-500"
                        strokeWidth="5"
                        fill="transparent"
                        strokeDasharray={213}
                        strokeDashoffset={213 - (213 * (selectedTask.analysis?.investmentScore || 50)) / 100}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="text-center">
                      <span className="text-xl font-bold text-white">{selectedTask.analysis?.investmentScore || 0}</span>
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Score</p>
                    </div>
                  </div>

                  <div>
                    <h3 className={`text-xl font-black tracking-wide ${selectedTask.recommendation?.decision === 'BUY'
                      ? 'text-emerald-400'
                      : selectedTask.recommendation?.decision === 'HOLD'
                        ? 'text-amber-400'
                        : 'text-slate-400'
                      }`}>
                      {selectedTask.recommendation?.decision || 'HOLD'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Confidence: {(selectedTask.recommendation?.confidenceScore * 100).toFixed(0)}%</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono">Horizon: {selectedTask.recommendation?.investmentHorizon || '12m'}</p>
                  </div>
                </div>
              </div>

              {/* Ratios & Scores Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Financial Health Summary Card */}
                <div className="glass-card rounded-2xl p-5 lg:col-span-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                      <Award className="h-4 w-4 text-sky-400" />
                      <span>Financial Health Analysis</span>
                    </div>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      {selectedTask.analysis?.financialHealth?.financialHealthSummary}
                    </p>
                  </div>

                  {/* Scores Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                    {[
                      { label: 'Revenue Growth', val: selectedTask.analysis?.financialHealth?.revenueGrowthScore },
                      { label: 'Margin Stability', val: selectedTask.analysis?.financialHealth?.marginStabilityScore },
                      { label: 'Debt & Leverage', val: selectedTask.analysis?.financialHealth?.debtLeverageScore },
                      { label: 'Cash Flow Power', val: selectedTask.analysis?.financialHealth?.cashFlowStrengthScore },
                    ].map((item, idx) => (
                      <div key={idx} className="bg-slate-950/40 border border-slate-800/40 rounded-xl p-3 text-center">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block truncate">{item.label}</span>
                        <span className="text-xl font-bold text-white block mt-1">{item.val ?? 0}<span className="text-xs text-slate-600 font-normal">/10</span></span>
                        <div className="h-1 w-full bg-slate-800 rounded-full mt-2 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 rounded-full"
                            style={{ width: `${(item.val || 0) * 10}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Technical Snapshot Card */}
                <div className="glass-card rounded-2xl p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">
                      <TrendingUp className="h-4 w-4 text-sky-400" />
                      <span>Technical Momentum Outlook</span>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-sm border-b border-slate-800/40 pb-2">
                        <span className="text-slate-400">Primary Trend</span>
                        <span className={`font-semibold capitalize ${selectedTask.analysis?.technicalOutlook?.trendDirection === 'uptrend'
                          ? 'text-emerald-400'
                          : selectedTask.analysis?.technicalOutlook?.trendDirection === 'downtrend'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                          }`}>
                          {selectedTask.analysis?.technicalOutlook?.trendDirection}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm border-b border-slate-800/40 pb-2">
                        <span className="text-slate-400">RSI (14) Indicator</span>
                        <span className="font-semibold text-white">
                          {selectedTask.research?.technicalIndicators?.rsi ? selectedTask.research.technicalIndicators.rsi.toFixed(1) : 'N/A'}
                          <span className="text-xs text-slate-500 ml-1">({selectedTask.analysis?.technicalOutlook?.rsiCondition})</span>
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm border-b border-slate-800/40 pb-2">
                        <span className="text-slate-400">Moving Averages (MA)</span>
                        <span className="font-semibold text-white truncate max-w-[130px]" title={selectedTask.analysis?.technicalOutlook?.smaCrossoverStatus}>
                          {selectedTask.analysis?.technicalOutlook?.smaCrossoverStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed italic mt-4 pt-3 border-t border-slate-800/40">
                    {selectedTask.analysis?.technicalOutlook?.technicalOutlookSummary}
                  </p>
                </div>
              </div>

              {/* SWOT Quadrant Matrix */}
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-white leading-none">SWOT Attractiveness Matrix</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Strengths (Green) */}
                  <div className="bg-emerald-950/10 border border-emerald-500/20 rounded-2xl p-5">
                    <h4 className="text-emerald-400 text-sm font-bold uppercase tracking-wider flex items-center space-x-2 mb-3">
                      <CheckCircle className="h-4.5 w-4.5" />
                      <span>Moats & Strengths</span>
                    </h4>
                    <ul className="space-y-2 text-slate-300 text-sm list-inside list-disc">
                      {selectedTask.analysis?.strengths?.map((str, idx) => (
                        <li key={idx}>{str}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Growth Drivers (Sky) */}
                  <div className="bg-sky-950/10 border border-sky-500/20 rounded-2xl p-5">
                    <h4 className="text-sky-400 text-sm font-bold uppercase tracking-wider flex items-center space-x-2 mb-3">
                      <Activity className="h-4.5 w-4.5" />
                      <span>Growth Catalysts</span>
                    </h4>
                    <ul className="space-y-2 text-slate-300 text-sm list-inside list-disc">
                      {selectedTask.analysis?.growthDrivers?.map((str, idx) => (
                        <li key={idx}>{str}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Weaknesses (Amber) */}
                  <div className="bg-amber-950/10 border border-amber-500/20 rounded-2xl p-5">
                    <h4 className="text-amber-400 text-sm font-bold uppercase tracking-wider flex items-center space-x-2 mb-3">
                      <AlertCircle className="h-4.5 w-4.5" />
                      <span>Weaknesses</span>
                    </h4>
                    <ul className="space-y-2 text-slate-300 text-sm list-inside list-disc">
                      {selectedTask.analysis?.weaknesses?.map((str, idx) => (
                        <li key={idx}>{str}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Risks (Rose) */}
                  <div className="bg-rose-950/10 border border-rose-500/20 rounded-2xl p-5">
                    <h4 className="text-rose-400 text-sm font-bold uppercase tracking-wider flex items-center space-x-2 mb-3">
                      <AlertTriangle className="h-4.5 w-4.5" />
                      <span>Risks & Vulnerabilities</span>
                    </h4>
                    <ul className="space-y-2 text-slate-300 text-sm list-inside list-disc">
                      {selectedTask.analysis?.risks?.map((str, idx) => (
                        <li key={idx}>{str}</li>
                      ))}
                    </ul>
                  </div>

                </div>
              </div>

              {/* Committee Thesis Justification */}
              <div className="glass-card rounded-2xl p-5">
                <div className="flex items-center space-x-2 text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                  <BookOpen className="h-4 w-4 text-sky-400" />
                  <span>Committee Directive Justification</span>
                </div>
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">
                  {selectedTask.recommendation?.reasoning}
                </div>
              </div>

              {/* Media Stream Card */}
              <div className="glass-card rounded-2xl p-5">
                <div className="flex items-center space-x-2 text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">
                  <FileText className="h-4 w-4 text-sky-400" />
                  <span>News Stream Sentiment</span>
                </div>

                {selectedTask.research?.news?.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No news articles found for ticker symbol.</p>
                ) : (
                  <div className="space-y-3.5">
                    {selectedTask.research.news.slice(0, 5).map((article, idx) => {
                      const sentiment = article.sentiment;

                      return (
                        <div key={idx} className="bg-slate-950/30 border border-slate-800/40 p-3.5 rounded-xl flex items-start justify-between gap-4">
                          <a href={article.url} target="_blank" rel="noopener noreferrer" className="block cursor-pointer">
                            <h5 className="font-semibold text-sm text-white leading-tight">{article.headline}</h5>
                            <div className="flex items-center space-x-2.5 mt-2 text-[11px] text-slate-500">
                              <span className="font-medium text-slate-400">{article.source}</span>
                              <span>•</span>
                              <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                            </div>
                          </a>

                          {sentiment && (
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${sentiment === 'Positive'
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : sentiment === 'Negative'
                                ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                                : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
                              }`}>
                              {sentiment}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Dynamic shadow-root container rendering HTML Report */}
              {selectedTask.report?.htmlReport && (
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-white leading-none">Publication Report Output</h3>
                  <div className="glass-card rounded-2xl overflow-hidden border border-slate-800/80">
                    <div className="p-4 border-b border-slate-800/60 bg-slate-950/20 flex items-center space-x-2">
                      <FileText className="h-4.5 w-4.5 text-sky-400" />
                      <span className="text-xs text-slate-400 font-semibold tracking-wide uppercase">Report Agent HTML Output</span>
                    </div>
                    {/* Shadow DOM styling sandbox container */}
                    <div
                      className="p-1 max-h-[600px] overflow-y-auto bg-slate-950/35"
                      dangerouslySetInnerHTML={{ __html: selectedTask.report.htmlReport }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}
        </main>
      </div>
    </div>
  );
}
