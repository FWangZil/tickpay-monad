"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createRelayerHttpClient } from "@tickpay/sdk/client/relayerHttp";
import styles from "./agent-to-agent.module.css";
import { NEXT_PUBLIC_LOGIC_CONTRACT, NEXT_PUBLIC_TOKEN, NEXT_PUBLIC_RELAYER_URL, createPublicClientForChain } from "@/lib/viem";

type AgentId = "agent-b" | "agent-c";
type StreamStatus = "queued" | "streaming" | "paused" | "finished";

interface StreamTask {
  id: string;
  title: string;
  assignee: AgentId;
  ratePerSecond: number;
  maxSeconds: number;
  elapsedSeconds: number;
  paidAmount: number;
  status: StreamStatus;
  policyId: number; // Unique policy ID for each task
  sessionId?: string;
  startTxHash?: string;
  closeTxHash?: string;
  error?: string;
}

interface LogEvent {
  id: string;
  text: string;
  createdAt: string;
}

interface DemoWallet {
  role: "agent-a" | "agent-b" | "agent-c";
  label: string;
  address: Address;
  privateKey: Hex;
}

const AGENT_LABEL: Record<AgentId, string> = {
  "agent-b": "Agent B",
  "agent-c": "Agent C",
};

const STATUS_CLASS: Record<StreamStatus, string> = {
  queued: styles.queued,
  streaming: styles.streaming,
  paused: styles.paused,
  finished: styles.finished,
};

function shortAddress(address: string) {
  if (!address.startsWith("0x") || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function isHexPrivateKey(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export default function AgentToAgentDemo() {
  const publicClient = useMemo(() => createPublicClientForChain(), []);
  const [relayerUrl, setRelayerUrl] = useState(NEXT_PUBLIC_RELAYER_URL);
  const relayerClient = useMemo(() => createRelayerHttpClient(relayerUrl), [relayerUrl]);

  const [agentAPrivateKey, setAgentAPrivateKey] = useState<Hex | "">("");
  const [agentAAddress, setAgentAAddress] = useState<Address | "">("");
  const [agentBAddress, setAgentBAddress] = useState<Address | "">("");
  const [agentCAddress, setAgentCAddress] = useState<Address | "">("");
  const [generatedWallets, setGeneratedWallets] = useState<DemoWallet[]>([]);

  const [taskTitle, setTaskTitle] = useState("Subtask: Summarize user feedback dataset");
  const [taskAssignee, setTaskAssignee] = useState<AgentId>("agent-b");
  const [taskRate, setTaskRate] = useState(0.001);
  const [taskMaxSeconds, setTaskMaxSeconds] = useState(300);

  const [tasks, setTasks] = useState<StreamTask[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nextPolicyId, setNextPolicyId] = useState(0);

  const [balances, setBalances] = useState({
    agentA: { tick: 0, native: 0 },
    agentB: { tick: 0, native: 0 },
    agentC: { tick: 0, native: 0 },
  });
  const [prevBalances, setPrevBalances] = useState({
    agentA: { tick: 0, native: 0 },
    agentB: { tick: 0, native: 0 },
    agentC: { tick: 0, native: 0 },
  });

  useEffect(() => {
    if (generatedWallets.length > 0) return;
    generateWalletSet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!agentAPrivateKey) {
      setAgentAAddress("");
      return;
    }

    if (!isHexPrivateKey(agentAPrivateKey)) {
      setAgentAAddress("");
      return;
    }

    try {
      const account = privateKeyToAccount(agentAPrivateKey);
      if (account.address !== agentAAddress) {
        setAgentAAddress(account.address);
      }
    } catch {
      setAgentAAddress("");
    }
  }, [agentAPrivateKey, agentAAddress]);

  useEffect(() => {
    const fetchBalances = async () => {
      if (!isAddress(NEXT_PUBLIC_TOKEN)) return;

      const addresses = [
        { key: "agentA" as const, address: agentAAddress },
        { key: "agentB" as const, address: agentBAddress },
        { key: "agentC" as const, address: agentCAddress },
      ];

      const newBalances: Record<string, { tick: number; native: number }> = {};

      for (const { key, address } of addresses) {
        if (!isAddress(address)) continue;
        try {
          const nativeBalance = await publicClient.getBalance({ address });
          const tickBalance = await publicClient.readContract({
            address: NEXT_PUBLIC_TOKEN,
            abi: [
              {
                name: "balanceOf",
                type: "function",
                stateMutability: "view",
                inputs: [{ name: "account", type: "address" }],
                outputs: [{ type: "uint256" }],
              },
            ],
            functionName: "balanceOf",
            args: [address],
          });
          newBalances[key] = {
            tick: Number(formatUnits(tickBalance as bigint, 18)),
            native: Number(formatUnits(nativeBalance, 18)),
          };
        } catch {
          // ignore errors
        }
      }

      setPrevBalances((prev) => ({
        agentA: balances.agentA,
        agentB: balances.agentB,
        agentC: balances.agentC,
      }));
      setBalances((prev) => ({
        agentA: newBalances.agentA || prev.agentA,
        agentB: newBalances.agentB || prev.agentB,
        agentC: newBalances.agentC || prev.agentC,
      }));
    };

    fetchBalances();
    const timer = setInterval(fetchBalances, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAAddress, agentBAddress, agentCAddress, publicClient]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const targets = tasks.filter(
        (task): task is StreamTask & { sessionId: string } =>
          task.status === "streaming" && typeof task.sessionId === "string",
      );
      if (targets.length === 0) return;

      for (const task of targets) {
        try {
          const data = await relayerClient.getSessionStatus(task.sessionId);
          if (!data.success) continue;

          const chargedSeconds = Number(data.chargedSeconds || "0");
          const chargedAmount = Number(formatUnits(BigInt(data.chargedAmount || "0"), 18));
          const shouldFinish = chargedSeconds >= task.maxSeconds;

          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    elapsedSeconds: chargedSeconds,
                    paidAmount: Number(chargedAmount.toFixed(6)),
                    status: shouldFinish ? "finished" : item.status,
                  }
                : item,
            ),
          );
        } catch {
          // keep polling others
        }
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [tasks, relayerClient]);

  const totalPaid = useMemo(
    () => tasks.reduce((sum, task) => sum + task.paidAmount, 0).toFixed(4),
    [tasks],
  );
  const streamingCount = useMemo(
    () => tasks.filter((task) => task.status === "streaming").length,
    [tasks],
  );

  function addLog(text: string) {
    setLogs((current) => [
      {
        id: crypto.randomUUID(),
        text,
        createdAt: nowLabel(),
      },
      ...current,
    ].slice(0, 24));
  }

  function createTask() {
    if (!taskTitle.trim()) return;
    const policyId = nextPolicyId;
    const newTask: StreamTask = {
      id: crypto.randomUUID(),
      title: taskTitle.trim(),
      assignee: taskAssignee,
      ratePerSecond: taskRate,
      maxSeconds: taskMaxSeconds,
      elapsedSeconds: 0,
      paidAmount: 0,
      status: "queued",
      policyId,
    };

    setNextPolicyId((prev) => prev + 1);
    setTasks((current) => [newTask, ...current]);
    setTaskTitle("");
    addLog(`Agent A assigned "${newTask.title}" to ${AGENT_LABEL[newTask.assignee]} (policy ${policyId}).`);
  }

  function seedScenario() {
    const policyIdB = nextPolicyId;
    const policyIdC = nextPolicyId + 1;
    const preset: StreamTask[] = [
      {
        id: crypto.randomUUID(),
        title: "Subtask: Execute retrieval + draft response",
        assignee: "agent-b",
        ratePerSecond: 0.0012,
        maxSeconds: 240,
        elapsedSeconds: 0,
        paidAmount: 0,
        status: "queued",
        policyId: policyIdB,
      },
      {
        id: crypto.randomUUID(),
        title: "Subtask: Run quality guardrails and lint report",
        assignee: "agent-c",
        ratePerSecond: 0.0008,
        maxSeconds: 220,
        elapsedSeconds: 0,
        paidAmount: 0,
        status: "queued",
        policyId: policyIdC,
      },
    ];
    setNextPolicyId((prev) => prev + 2);
    setTasks((current) => [...preset, ...current]);
    addLog(`Preset scenario loaded: Agent A delegated two subtasks (policy ${policyIdB}, ${policyIdC}).`);
  }

  async function startTask(taskId: string) {
    setLastError(null);
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!agentAPrivateKey) {
      setLastError("Agent A private key is required.");
      return;
    }
    const payeeAddress = task.assignee === "agent-b" ? agentBAddress : agentCAddress;
    if (!isAddress(agentAAddress) || !isAddress(payeeAddress)) {
      setLastError("Agent wallets are invalid.");
      return;
    }
    if (!isAddress(NEXT_PUBLIC_LOGIC_CONTRACT)) {
      setLastError("Missing NEXT_PUBLIC_LOGIC_CONTRACT.");
      return;
    }

    try {
      setIsBusy(true);
      const account = privateKeyToAccount(agentAPrivateKey);

      const createData = await relayerClient.createSession({
        userAddress: account.address,
        policyId: task.policyId,
      });

      const signature = await account.signTypedData({
        domain: {
          name: createData.domain.name,
          version: createData.domain.version,
          chainId: Number(createData.domain.chainId),
          verifyingContract: createData.domain.verifyingContract as Address,
        },
        types: {
          SessionRequest: [
            { name: "user", type: "address" },
            { name: "policyId", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "SessionRequest",
        message: {
          user: createData.message.user as Address,
          policyId: BigInt(createData.message.policyId),
          nonce: BigInt(createData.message.nonce),
          deadline: BigInt(createData.message.deadline),
        },
      });

      const startData = await relayerClient.startSession({
        userAddress: account.address,
        signature,
        userPrivateKey: agentAPrivateKey,
        policyId: task.policyId,
        deadline: createData.message.deadline,
        nonce: createData.message.nonce,
        payee: payeeAddress,
      });

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "streaming",
                sessionId: startData.sessionId,
                startTxHash: startData.txHash,
                error: undefined,
              }
            : item,
        ),
      );
      setLastError(null);
      addLog(`${AGENT_LABEL[task.assignee]} stream started. session=${String(startData.sessionId).slice(0, 10)}...`);
    } catch (error: any) {
      const message = error.message || "Failed to start task stream.";
      setLastError(message);
      setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, error: message } : item)));
      addLog(`Start failed: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  function pauseTask(taskId: string) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId && task.status === "streaming" ? { ...task, status: "paused" } : task)),
    );
    addLog(`Paused stream payment for task ${taskId.slice(0, 8)}.`);
  }

  function finishTask(taskId: string) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status: "finished" } : task)),
    );
    addLog(`Finalized stream payment for task ${taskId.slice(0, 8)}.`);
  }

  async function stopTask(taskId: string) {
    setLastError(null);
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.sessionId) return;
    if (!agentAPrivateKey || !isAddress(agentAAddress)) {
      setLastError("Agent A key and address are required to stop and revoke.");
      return;
    }

    try {
      setIsBusy(true);
      const stopData = await relayerClient.stopSession({
        sessionId: task.sessionId,
        userAddress: agentAAddress,
        userPrivateKey: agentAPrivateKey,
      });

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "finished",
                closeTxHash: stopData.closeTxHash ?? undefined,
                error: undefined,
              }
            : item,
        ),
      );
      setLastError(null);
      addLog(`Stopped stream session ${task.sessionId.slice(0, 10)}...`);
    } catch (error: any) {
      const message = error.message || "Failed to stop stream.";
      setLastError(message);
      setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, error: message } : item)));
      addLog(`Stop failed: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function startAllQueued() {
    const pending = tasks.filter((task) => task.status === "queued" || task.status === "paused");
    for (const task of pending) {
      // sequential on purpose to reduce nonce collision
      // eslint-disable-next-line no-await-in-loop
      await startTask(task.id);
    }
  }

  function generateWalletSet() {
    const seeds: Array<Pick<DemoWallet, "role" | "label" | "privateKey">> = [
      { role: "agent-a", label: "Agent A", privateKey: generatePrivateKey() as Hex },
      { role: "agent-b", label: "Agent B", privateKey: generatePrivateKey() as Hex },
      { role: "agent-c", label: "Agent C", privateKey: generatePrivateKey() as Hex },
    ];
    const items: DemoWallet[] = seeds.map((item) => {
      const account = privateKeyToAccount(item.privateKey);
      return { ...item, address: account.address };
    });
    setGeneratedWallets(items);

    const a = items.find((w) => w.role === "agent-a");
    const b = items.find((w) => w.role === "agent-b");
    const c = items.find((w) => w.role === "agent-c");
    if (a && b && c) {
      setAgentAPrivateKey(a.privateKey);
      setAgentAAddress(a.address);
      setAgentBAddress(b.address);
      setAgentCAddress(c.address);
    }
    addLog("Generated fresh demo wallets for Agent A/B/C.");
  }

  function exportWalletsAsJson() {
    const payload = {
      generatedAt: new Date().toISOString(),
      wallets: generatedWallets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, "agent-wallets.json");
  }

  function exportWalletsAsCsv() {
    const header = "role,label,address,privateKey";
    const rows = generatedWallets.map((w) => `${w.role},${w.label},${w.address},${w.privateKey}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, "agent-wallets.csv");
  }

  function importWalletsFromJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Support both { wallets: [...] } and direct array formats
        const wallets: DemoWallet[] = data.wallets || data;

        if (!Array.isArray(wallets) || wallets.length === 0) {
          throw new Error("Invalid wallet file format");
        }

        // Validate wallet structure
        for (const w of wallets) {
          if (!w.role || !w.address || !w.privateKey) {
            throw new Error("Missing required wallet fields");
          }
        }

        setGeneratedWallets(wallets);

        const a = wallets.find((w) => w.role === "agent-a");
        const b = wallets.find((w) => w.role === "agent-b");
        const c = wallets.find((w) => w.role === "agent-c");

        if (a) {
          setAgentAPrivateKey(a.privateKey);
          setAgentAAddress(a.address);
        }
        if (b) setAgentBAddress(b.address);
        if (c) setAgentCAddress(c.address);

        addLog(`Imported ${wallets.length} wallet(s) from file.`);
        setLastError(null);
      } catch (error: any) {
        setLastError(`Import failed: ${error.message}`);
        addLog(`Import failed: ${error.message}`);
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be selected again
    event.target.value = "";
  }

  async function faucetWallet(address: Address) {
    try {
      await relayerClient.faucet({ address });
      setLastError(null);
      addLog(`Faucet sent tokens to ${shortAddress(address)}.`);
    } catch (error: any) {
      addLog(`Faucet failed for ${shortAddress(address)}: ${error.message}`);
      setLastError(error.message || "Faucet failed");
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const agentBTasks = tasks.filter((task) => task.assignee === "agent-b");
  const agentCTasks = tasks.filter((task) => task.assignee === "agent-c");

  const agentBRevenue = agentBTasks.reduce((sum, task) => sum + task.paidAmount, 0).toFixed(4);
  const agentCRevenue = agentCTasks.reduce((sum, task) => sum + task.paidAmount, 0).toFixed(4);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Hero Section */}
        <section className={styles.hero}>
          <h1>Agent-to-Agent Streaming Payments</h1>
          <p>
            Agent A delegates work to Agent B and Agent C. Each subtask opens a live payment stream
            that pays per second while work continues.
          </p>
        </section>

        {/* Balance Dashboard */}
        <section className={styles.balanceSection}>
          <div className={styles.balanceCard}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceIcon}>A</span>
              <span className={styles.balanceLabel}>Agent A</span>
              <span className={styles.balanceRole}>Payer</span>
            </div>
            <div className={styles.balanceAddress}>{shortAddress(agentAAddress) || "Not set"}</div>
            <div className={styles.balanceRow}>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>TICK</span>
                <span className={`${styles.balanceValue} ${balances.agentA.tick < prevBalances.agentA.tick ? styles.decreasing : ""}`}>
                  {balances.agentA.tick.toFixed(4)}
                </span>
                {balances.agentA.tick < prevBalances.agentA.tick && (
                  <span className={styles.balanceDelta}>↓</span>
                )}
              </div>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>MON</span>
                <span className={styles.balanceValue}>{balances.agentA.native.toFixed(4)}</span>
              </div>
            </div>
          </div>

          <div className={styles.flowIndicator}>
            <div className={styles.flowLine}>
              <div className={styles.flowDot}></div>
              <div className={styles.flowDot}></div>
              <div className={styles.flowDot}></div>
            </div>
            <span className={styles.flowText}>Streaming</span>
          </div>

          <div className={styles.balanceCard}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceIcon}>B</span>
              <span className={styles.balanceLabel}>Agent B</span>
              <span className={styles.balanceRole}>Worker</span>
            </div>
            <div className={styles.balanceAddress}>{shortAddress(agentBAddress) || "Not set"}</div>
            <div className={styles.balanceRow}>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>TICK</span>
                <span className={`${styles.balanceValue} ${balances.agentB.tick > prevBalances.agentB.tick ? styles.increasing : ""}`}>
                  {balances.agentB.tick.toFixed(4)}
                </span>
                {balances.agentB.tick > prevBalances.agentB.tick && (
                  <span className={`${styles.balanceDelta} ${styles.up}`}>↑</span>
                )}
              </div>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>MON</span>
                <span className={styles.balanceValue}>{balances.agentB.native.toFixed(4)}</span>
              </div>
            </div>
          </div>

          <div className={styles.flowIndicator}>
            <div className={styles.flowLine}>
              <div className={styles.flowDot}></div>
              <div className={styles.flowDot}></div>
              <div className={styles.flowDot}></div>
            </div>
            <span className={styles.flowText}>Streaming</span>
          </div>

          <div className={styles.balanceCard}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceIcon}>C</span>
              <span className={styles.balanceLabel}>Agent C</span>
              <span className={styles.balanceRole}>Worker</span>
            </div>
            <div className={styles.balanceAddress}>{shortAddress(agentCAddress) || "Not set"}</div>
            <div className={styles.balanceRow}>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>TICK</span>
                <span className={`${styles.balanceValue} ${balances.agentC.tick > prevBalances.agentC.tick ? styles.increasing : ""}`}>
                  {balances.agentC.tick.toFixed(4)}
                </span>
                {balances.agentC.tick > prevBalances.agentC.tick && (
                  <span className={`${styles.balanceDelta} ${styles.up}`}>↑</span>
                )}
              </div>
              <div className={styles.balanceItem}>
                <span className={styles.balanceToken}>MON</span>
                <span className={styles.balanceValue}>{balances.agentC.native.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.mainGrid}>
          {/* Left Column: Control Panels */}
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelIcon}>⚡</div>
              <h2>Agent A Control Plane</h2>
            </div>

            <div className={styles.configSection}>
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label>Relayer URL</label>
                  <input value={relayerUrl} onChange={(e) => setRelayerUrl(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Agent A Private Key</label>
                  <input
                    type="password"
                    value={agentAPrivateKey}
                    onChange={(e) => setAgentAPrivateKey((e.target.value || "") as Hex | "")}
                    placeholder="Demo only - never persisted"
                  />
                </div>
                <div className={styles.field}>
                  <label>Agent A Address</label>
                  <input value={agentAAddress} readOnly />
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label>Agent B Wallet</label>
                  <input value={agentBAddress} onChange={(e) => setAgentBAddress((e.target.value || "") as Address | "")} />
                </div>
                <div className={styles.field}>
                  <label>Agent C Wallet</label>
                  <input value={agentCAddress} onChange={(e) => setAgentCAddress((e.target.value || "") as Address | "")} />
                </div>
              </div>
            </div>

            <div className={styles.buttonGroup}>
              <button className={`${styles.button} ${styles.primary}`} onClick={generateWalletSet} type="button">
                Generate Wallets
              </button>
              <label className={`${styles.button} ${styles.secondary} ${styles.fileLabel}`}>
                Import Wallets
                <input
                  type="file"
                  accept=".json"
                  onChange={importWalletsFromJson}
                  className={styles.fileInput}
                />
              </label>
              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={exportWalletsAsJson}
                type="button"
                disabled={generatedWallets.length === 0}
              >
                Export JSON
              </button>
            </div>

            <div className={styles.faucetRow}>
              {generatedWallets.map((wallet) => (
                <button
                  key={wallet.role}
                  className={`${styles.button} ${styles.secondary} ${styles.small}`}
                  type="button"
                  onClick={() => faucetWallet(wallet.address)}
                >
                  Faucet {wallet.label}
                </button>
              ))}
            </div>
          </article>

          {/* Right Column: Task Form */}
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelIcon}>📋</div>
              <h2>Task Dispatch Form</h2>
            </div>

            <div className={styles.taskForm}>
              <div className={styles.field}>
                <label>Task Title</label>
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              </div>

              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label>Assign To</label>
                  <select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value as AgentId)}>
                    <option value="agent-b">Agent B</option>
                    <option value="agent-c">Agent C</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Rate (TICK/sec)</label>
                  <input
                    type="number"
                    value={taskRate}
                    min="0.001"
                    step="0.001"
                    onChange={(e) => setTaskRate(Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Max Seconds</label>
                  <input
                    type="number"
                    value={taskMaxSeconds}
                    min="10"
                    step="5"
                    onChange={(e) => setTaskMaxSeconds(Number(e.target.value))}
                  />
                </div>
              </div>

              <button className={`${styles.button} ${styles.primary}`} onClick={createTask} type="button">
                Assign Task + Queue Stream
              </button>
              <div className={styles.buttonRow}>
                <button className={`${styles.button} ${styles.secondary}`} onClick={seedScenario} type="button">
                  Load Demo Scenario
                </button>
                <button
                  className={`${styles.button} ${styles.success}`}
                  onClick={startAllQueued}
                  type="button"
                  disabled={tasks.length === 0 || isBusy}
                >
                  Start All Streams
                </button>
              </div>
            </div>
          </article>

          {/* Dashboard Section */}
          <div className={styles.dashboardGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelIcon}>📊</div>
                <h2>Live Stream Dashboard</h2>
              </div>

              <div className={styles.summary}>
                <div className={styles.kpi}>
                  <span className={styles.label}>Agent A Total Paid</span>
                  <span className={styles.value}>{totalPaid} TICK</span>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.label}>Active Streams</span>
                  <span className={styles.value}>{streamingCount}</span>
                </div>
              </div>

              <div className={styles.laneWrap}>
                <div className={styles.lane}>
                  <div className={styles.laneHeader}>
                    <h3>Agent B Tasks</h3>
                    <span className={styles.laneRevenue}>+{agentBRevenue} TICK</span>
                  </div>
                  <p className={styles.streamMeta}>{shortAddress(agentBAddress)}</p>
                  <div className={styles.streamList}>
                    {agentBTasks.length === 0 ? (
                      <p className={styles.streamMeta}>No tasks assigned yet</p>
                    ) : (
                      agentBTasks.map((task) => (
                        <div className={styles.stream} key={task.id}>
                          <div className={styles.streamHeader}>
                            <p className={styles.streamTitle}>{task.title}</p>
                            <span className={`${styles.badge} ${STATUS_CLASS[task.status]}`}>{task.status}</span>
                          </div>
                          <div className={styles.streamProgress}>
                            <div className={styles.progressBar}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${Math.min((task.elapsedSeconds / task.maxSeconds) * 100, 100)}%` }}
                              />
                            </div>
                            <span className={styles.progressText}>
                              {task.elapsedSeconds}s / {task.maxSeconds}s
                            </span>
                          </div>
                          <p className={styles.streamMeta}>
                            {task.paidAmount.toFixed(4)} TICK @ {task.ratePerSecond}/s
                          </p>
                          <div className={styles.streamActions}>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => startTask(task.id)}
                              type="button"
                              disabled={isBusy || task.status === "streaming" || task.status === "finished"}
                            >
                              Start
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => pauseTask(task.id)}
                              type="button"
                            >
                              Pause
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => finishTask(task.id)}
                              type="button"
                            >
                              Finish
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => stopTask(task.id)}
                              type="button"
                              disabled={isBusy || !task.sessionId}
                            >
                              Stop
                            </button>
                          </div>
                          {task.error && <p className={styles.streamMeta} style={{ color: "#f87171" }}>{task.error}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.lane}>
                  <div className={styles.laneHeader}>
                    <h3>Agent C Tasks</h3>
                    <span className={styles.laneRevenue}>+{agentCRevenue} TICK</span>
                  </div>
                  <p className={styles.streamMeta}>{shortAddress(agentCAddress)}</p>
                  <div className={styles.streamList}>
                    {agentCTasks.length === 0 ? (
                      <p className={styles.streamMeta}>No tasks assigned yet</p>
                    ) : (
                      agentCTasks.map((task) => (
                        <div className={styles.stream} key={task.id}>
                          <div className={styles.streamHeader}>
                            <p className={styles.streamTitle}>{task.title}</p>
                            <span className={`${styles.badge} ${STATUS_CLASS[task.status]}`}>{task.status}</span>
                          </div>
                          <div className={styles.streamProgress}>
                            <div className={styles.progressBar}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${Math.min((task.elapsedSeconds / task.maxSeconds) * 100, 100)}%` }}
                              />
                            </div>
                            <span className={styles.progressText}>
                              {task.elapsedSeconds}s / {task.maxSeconds}s
                            </span>
                          </div>
                          <p className={styles.streamMeta}>
                            {task.paidAmount.toFixed(4)} TICK @ {task.ratePerSecond}/s
                          </p>
                          <div className={styles.streamActions}>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => startTask(task.id)}
                              type="button"
                              disabled={isBusy || task.status === "streaming" || task.status === "finished"}
                            >
                              Start
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => pauseTask(task.id)}
                              type="button"
                            >
                              Pause
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => finishTask(task.id)}
                              type="button"
                            >
                              Finish
                            </button>
                            <button
                              className={`${styles.button} ${styles.secondary} ${styles.small}`}
                              onClick={() => stopTask(task.id)}
                              type="button"
                              disabled={isBusy || !task.sessionId}
                            >
                              Stop
                            </button>
                          </div>
                          {task.error && <p className={styles.streamMeta} style={{ color: "#f87171" }}>{task.error}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </article>

            {/* Event Log */}
            <article className={`${styles.panel} ${styles.logSection}`}>
              <div className={styles.panelHeader}>
                <div className={styles.panelIcon}>📝</div>
                <h2>Event Log</h2>
              </div>

              <div className={styles.walletInfo}>
                <span>Payer:</span>
                <span className={styles.walletAddress}>{shortAddress(agentAAddress)}</span>
                <span>|</span>
                <span>Key: {agentAPrivateKey ? "Set" : "Not set"}</span>
              </div>

              {lastError && (
                <p className={styles.streamMeta} style={{ color: "#f87171", marginBottom: "12px" }}>
                  Error: {lastError}
                </p>
              )}

              <div className={styles.logBox}>
                {logs.length === 0 ? (
                  <p className={styles.logItem}>No events yet. Load a preset or assign a task.</p>
                ) : (
                  logs.map((log) => (
                    <p className={styles.logItem} key={log.id}>
                      <span className={styles.logTime}>[{log.createdAt}]</span>
                      <span className={styles.logText}>{log.text}</span>
                    </p>
                  ))
                )}
              </div>
            </article>
          </div>
        </div>
      </div>
    </main>
  );
}
