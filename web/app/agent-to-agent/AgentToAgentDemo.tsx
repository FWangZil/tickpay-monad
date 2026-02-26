"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import styles from "./agent-to-agent.module.css";
import { NEXT_PUBLIC_LOGIC_CONTRACT, NEXT_PUBLIC_RELAYER_URL, createPublicClientForChain } from "@/lib/viem";

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

export default function AgentToAgentDemo() {
  const publicClient = useMemo(() => createPublicClientForChain(), []);
  const [relayerUrl, setRelayerUrl] = useState(NEXT_PUBLIC_RELAYER_URL);

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

  useEffect(() => {
    if (generatedWallets.length > 0) return;
    generateWalletSet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      const targets = tasks.filter((task) => task.status === "streaming" && task.sessionId);
      if (targets.length === 0) return;

      for (const task of targets) {
        try {
          const response = await fetch(`${relayerUrl}/api/session/status/${task.sessionId}`);
          const data = await response.json();
          if (!response.ok || !data.success) continue;

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
  }, [tasks, relayerUrl]);

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
    const newTask: StreamTask = {
      id: crypto.randomUUID(),
      title: taskTitle.trim(),
      assignee: taskAssignee,
      ratePerSecond: taskRate,
      maxSeconds: taskMaxSeconds,
      elapsedSeconds: 0,
      paidAmount: 0,
      status: "queued",
    };

    setTasks((current) => [newTask, ...current]);
    setTaskTitle("");
    addLog(`Agent A assigned "${newTask.title}" to ${AGENT_LABEL[newTask.assignee]}.`);
  }

  function seedScenario() {
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
      },
    ];
    setTasks((current) => [...preset, ...current]);
    addLog("Preset scenario loaded: Agent A delegated two subtasks to Agent B and Agent C.");
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

      const createRes = await fetch(`${relayerUrl}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: account.address,
          policyId: 0,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || "Failed to create session");
      }

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

      const nonce = await publicClient.getTransactionCount({ address: account.address });
      const authorization = await account.signAuthorization({
        address: NEXT_PUBLIC_LOGIC_CONTRACT,
        chainId: Number(createData.domain.chainId),
        nonce,
      });

      const startRes = await fetch(`${relayerUrl}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: account.address,
          signature,
          policyId: 0,
          deadline: createData.message.deadline,
          nonce: createData.message.nonce,
          payee: payeeAddress,
          authorizationList: [
            {
              address: NEXT_PUBLIC_LOGIC_CONTRACT,
              chainId: Number(authorization.chainId),
              nonce: Number(authorization.nonce),
              r: authorization.r,
              s: authorization.s,
              yParity: authorization.yParity,
              v: authorization.v ? Number(authorization.v) : undefined,
            },
          ],
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) {
        throw new Error(startData.details || startData.error || "Failed to start session");
      }

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
      const stopRes = await fetch(`${relayerUrl}/api/session/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: task.sessionId,
          userAddress: agentAAddress,
          userPrivateKey: agentAPrivateKey,
        }),
      });
      const stopData = await stopRes.json();
      if (!stopRes.ok) {
        throw new Error(stopData.details || stopData.error || "Failed to stop session");
      }

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "finished",
                closeTxHash: stopData.closeTxHash,
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

  async function faucetWallet(address: Address) {
    try {
      const res = await fetch(`${relayerUrl}/api/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Faucet failed");
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
        <section className={styles.hero}>
          <h1>Agent-to-Agent Streaming Payments Playground</h1>
          <p>
            Agent A delegates work to Agent B and Agent C. Each subtask opens a live payment stream and pays per second
            while work continues.
          </p>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <h2>Agent A Control Plane</h2>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Relayer URL</label>
                <input value={relayerUrl} onChange={(e) => setRelayerUrl(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Agent A Private Key (demo only)</label>
                <input
                  type="password"
                  value={agentAPrivateKey}
                  onChange={(e) => setAgentAPrivateKey((e.target.value || "") as Hex | "")}
                  placeholder="0x... only in-memory for hackathon demo"
                />
              </div>
              <div className={styles.field}>
                <label>Agent A Address</label>
                <input value={agentAAddress} onChange={(e) => setAgentAAddress((e.target.value || "") as Address | "")} />
              </div>
              <div className={styles.field}>
                <label>Agent B Wallet</label>
                <input value={agentBAddress} onChange={(e) => setAgentBAddress((e.target.value || "") as Address | "")} />
              </div>
              <div className={styles.field}>
                <label>Agent C Wallet</label>
                <input value={agentCAddress} onChange={(e) => setAgentCAddress((e.target.value || "") as Address | "")} />
              </div>
            </div>
            <div className={styles.btnRow}>
              <button className={`${styles.button} ${styles.secondary}`} onClick={generateWalletSet} type="button">
                Generate A/B/C Wallets
              </button>
              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={exportWalletsAsJson}
                type="button"
                disabled={generatedWallets.length === 0}
              >
                Export JSON
              </button>
              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={exportWalletsAsCsv}
                type="button"
                disabled={generatedWallets.length === 0}
              >
                Export CSV
              </button>
              <button className={`${styles.button} ${styles.secondary}`} onClick={seedScenario} type="button">
                Load B/C Scenario
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={startAllQueued}
                type="button"
                disabled={tasks.length === 0 || isBusy}
              >
                Start All Streams
              </button>
            </div>
            <div className={styles.btnRow}>
              {generatedWallets.map((wallet) => (
                <button
                  key={wallet.role}
                  className={`${styles.button} ${styles.secondary}`}
                  type="button"
                  onClick={() => faucetWallet(wallet.address)}
                >
                  Faucet {wallet.label}
                </button>
              ))}
            </div>
            <div className={styles.btnRow}>
              <button className={`${styles.button} ${styles.warning}`} type="button" disabled>
                Demo note: private key never persisted; use test wallet only
              </button>
            </div>
          </article>

          <article className={styles.panel}>
            <h2>Task Dispatch Form</h2>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>Task Title</label>
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Assign To</label>
                <select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value as AgentId)}>
                  <option value="agent-b">Agent B</option>
                  <option value="agent-c">Agent C</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Rate Per Second (TICK)</label>
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
            <div className={styles.btnRow}>
              <button className={`${styles.button} ${styles.primary}`} onClick={createTask} type="button">
                Assign Task + Queue Stream
              </button>
            </div>
          </article>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <h2>Live Stream Dashboard</h2>
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
                <h3>Agent B Revenue: {agentBRevenue} TICK</h3>
                <p className={styles.streamMeta}>Wallet: {shortAddress(agentBAddress)}</p>
                <div className={styles.streamList}>
                  {agentBTasks.map((task) => (
                    <div className={styles.stream} key={task.id}>
                      <p className={styles.streamTitle}>{task.title}</p>
                      <p className={styles.streamMeta}>
                        {task.elapsedSeconds}s / {task.maxSeconds}s, {task.paidAmount.toFixed(4)} TICK
                      </p>
                      <div className={styles.btnRow}>
                        <span className={`${styles.badge} ${STATUS_CLASS[task.status]}`}>{task.status}</span>
                        <button
                          className={`${styles.button} ${styles.secondary}`}
                          onClick={() => startTask(task.id)}
                          type="button"
                          disabled={isBusy || task.status === "streaming" || task.status === "finished"}
                        >
                          Start
                        </button>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={() => pauseTask(task.id)} type="button">
                          Pause
                        </button>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={() => finishTask(task.id)} type="button">
                          Finish
                        </button>
                        <button
                          className={`${styles.button} ${styles.secondary}`}
                          onClick={() => stopTask(task.id)}
                          type="button"
                          disabled={isBusy || !task.sessionId}
                        >
                          Stop Onchain
                        </button>
                      </div>
                      {task.sessionId && <p className={styles.streamMeta}>session: {shortAddress(task.sessionId)}</p>}
                      {task.startTxHash && <p className={styles.streamMeta}>start tx: {shortAddress(task.startTxHash)}</p>}
                      {task.closeTxHash && <p className={styles.streamMeta}>stop tx: {shortAddress(task.closeTxHash)}</p>}
                      {task.error && <p className={styles.streamMeta}>error: {task.error}</p>}
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.lane}>
                <h3>Agent C Revenue: {agentCRevenue} TICK</h3>
                <p className={styles.streamMeta}>Wallet: {shortAddress(agentCAddress)}</p>
                <div className={styles.streamList}>
                  {agentCTasks.map((task) => (
                    <div className={styles.stream} key={task.id}>
                      <p className={styles.streamTitle}>{task.title}</p>
                      <p className={styles.streamMeta}>
                        {task.elapsedSeconds}s / {task.maxSeconds}s, {task.paidAmount.toFixed(4)} TICK
                      </p>
                      <div className={styles.btnRow}>
                        <span className={`${styles.badge} ${STATUS_CLASS[task.status]}`}>{task.status}</span>
                        <button
                          className={`${styles.button} ${styles.secondary}`}
                          onClick={() => startTask(task.id)}
                          type="button"
                          disabled={isBusy || task.status === "streaming" || task.status === "finished"}
                        >
                          Start
                        </button>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={() => pauseTask(task.id)} type="button">
                          Pause
                        </button>
                        <button className={`${styles.button} ${styles.secondary}`} onClick={() => finishTask(task.id)} type="button">
                          Finish
                        </button>
                        <button
                          className={`${styles.button} ${styles.secondary}`}
                          onClick={() => stopTask(task.id)}
                          type="button"
                          disabled={isBusy || !task.sessionId}
                        >
                          Stop Onchain
                        </button>
                      </div>
                      {task.sessionId && <p className={styles.streamMeta}>session: {shortAddress(task.sessionId)}</p>}
                      {task.startTxHash && <p className={styles.streamMeta}>start tx: {shortAddress(task.startTxHash)}</p>}
                      {task.closeTxHash && <p className={styles.streamMeta}>stop tx: {shortAddress(task.closeTxHash)}</p>}
                      {task.error && <p className={styles.streamMeta}>error: {task.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className={styles.panel}>
            <h2>Event Log</h2>
            <p className={styles.streamMeta}>
              Stream payer: {shortAddress(agentAAddress)} | key set: {agentAPrivateKey ? "yes" : "no"}
            </p>
            {lastError && <p className={styles.streamMeta}>latest error: {lastError}</p>}
            <div className={styles.logBox}>
              {logs.length === 0 ? (
                <p className={styles.logItem}>No events yet. Load a preset or assign a task.</p>
              ) : (
                logs.map((log) => (
                  <p className={styles.logItem} key={log.id}>
                    [{log.createdAt}] {log.text}
                  </p>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
