import { useEffect, useMemo, useState } from "react";
import "./App.css";

const BLE_SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
const BLE_DATA_CHAR_UUID = "abcd1234-5678-90ab-cdef-1234567890ab";
const BLE_CTRL_CHAR_UUID = "dcba4321-8765-ba09-fedc-0987654321ab";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const initialData = {
  temp: 26.7,
  humi: 58.0,
  lux: 39,
  noise: 1466,
  gas: 13,
  pm25: 8.5,
  alarm: false,
  updatedAt: new Date().toLocaleTimeString(),
};

const initialThresholds = {
  gas: 2000,
  noise: 2000,
  pm25Warn: 10,
  pm25Alarm: 20,
};

function parseBleDataPayload(payload) {
  const result = {};
  payload.split(",").forEach((part) => {
    const [key, value] = part.split("=");
    if (!key || value == null) return;
    result[key.trim()] = value.trim();
  });

  return {
    temp: Number(result.T ?? 0),
    humi: Number(result.H ?? 0),
    lux: Number(result.L ?? 0),
    noise: Number(result.NOI ?? 0),
    gas: Number(result.GAS ?? 0),
    pm25: Number(result.PM ?? 0),
    alarm: String(result.ALM ?? "0") === "1",
    updatedAt: new Date().toLocaleTimeString(),
  };
}

function parseThresholdPayload(payload) {
  const text = payload.trim();
  if (!text.startsWith("THR,")) return null;

  const parts = text.split(",");
  if (parts.length !== 5) return null;

  return {
    gas: Number(parts[1]),
    noise: Number(parts[2]),
    pm25Warn: Number(parts[3]),
    pm25Alarm: Number(parts[4]),
  };
}

function MetricCard({ title, value, unit, highlight = false }) {
  return (
    <div className={`card metric-card ${highlight ? "highlight" : ""}`}>
      <div className="metric-title">{title}</div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(initialData);
  const [thresholds, setThresholds] = useState(initialThresholds);

  const [device, setDevice] = useState(null);
  const [dataChar, setDataChar] = useState(null);
  const [ctrlChar, setCtrlChar] = useState(null);

  const [bleConnected, setBleConnected] = useState(false);
  const [status, setStatus] = useState("未连接 BLE");
  const [lastPayload, setLastPayload] = useState("");
  const [autoMock, setAutoMock] = useState(true);

  const supportBle = typeof navigator !== "undefined" && !!navigator.bluetooth;

  const thresholdCommand = useMemo(() => {
    return `SET,${thresholds.gas},${thresholds.noise},${thresholds.pm25Warn},${thresholds.pm25Alarm}`;
  }, [thresholds]);

  useEffect(() => {
    if (!autoMock || bleConnected) return;

    const timer = setInterval(() => {
      setData((prev) => {
        const next = {
          ...prev,
          temp: Number((prev.temp + (Math.random() - 0.5) * 0.4).toFixed(1)),
          humi: Number((prev.humi + (Math.random() - 0.5) * 1.2).toFixed(1)),
          lux: Math.max(0, Math.round(prev.lux + (Math.random() - 0.5) * 8)),
          noise: Math.max(0, Math.round(prev.noise + (Math.random() - 0.5) * 120)),
          gas: Math.max(0, Math.round(prev.gas + (Math.random() - 0.5) * 4)),
          pm25: Math.max(0, Number((prev.pm25 + (Math.random() - 0.5) * 2.5).toFixed(1))),
          updatedAt: new Date().toLocaleTimeString(),
        };
        next.alarm =
          next.pm25 >= thresholds.pm25Alarm ||
          next.noise >= thresholds.noise ||
          next.gas >= thresholds.gas;
        return next;
      });
    }, 1500);

    return () => clearInterval(timer);
  }, [autoMock, bleConnected, thresholds]);

  useEffect(() => {
    if (!device) return;

    const onDisconnect = () => {
      setBleConnected(false);
      setDataChar(null);
      setCtrlChar(null);
      setStatus("BLE 已断开");
    };

    device.addEventListener("gattserverdisconnected", onDisconnect);
    return () => device.removeEventListener("gattserverdisconnected", onDisconnect);
  }, [device]);

  async function connectBle() {
    try {
      if (!navigator.bluetooth) {
        setStatus("当前浏览器不支持 Web Bluetooth");
        return;
      }

      setStatus("正在搜索 BLE 设备...");
      const selectedDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID],
      });

      const server = await selectedDevice.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);

      const dataCharacteristic = await service.getCharacteristic(BLE_DATA_CHAR_UUID);
      const ctrlCharacteristic = await service.getCharacteristic(BLE_CTRL_CHAR_UUID);

      await dataCharacteristic.startNotifications();

      dataCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
        const value = event.target.value;
        const text = decoder.decode(value.buffer);
        setLastPayload(text);
        setData(parseBleDataPayload(text));
      });

      const thresholdValue = await ctrlCharacteristic.readValue();
      const thresholdText = decoder.decode(thresholdValue.buffer);
      const parsedThresholds = parseThresholdPayload(thresholdText);
      if (parsedThresholds) {
        setThresholds(parsedThresholds);
      }

      const dataValue = await dataCharacteristic.readValue();
      const dataText = decoder.decode(dataValue.buffer);
      if (dataText) {
        setLastPayload(dataText);
        setData(parseBleDataPayload(dataText));
      }

      setDevice(selectedDevice);
      setDataChar(dataCharacteristic);
      setCtrlChar(ctrlCharacteristic);
      setBleConnected(true);
      setAutoMock(false);
      setStatus(`已连接：${selectedDevice.name || "ESP32 设备"}`);
    } catch (err) {
      setStatus(`连接失败：${err.message}`);
    }
  }

  async function disconnectBle() {
    try {
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
      setBleConnected(false);
      setDataChar(null);
      setCtrlChar(null);
      setStatus("BLE 已断开");
    } catch (err) {
      setStatus(`断开失败：${err.message}`);
    }
  }

  async function readThresholds() {
    try {
      if (!ctrlChar) {
        setStatus("请先连接 BLE");
        return;
      }

      const value = await ctrlChar.readValue();
      const text = decoder.decode(value.buffer);
      const parsed = parseThresholdPayload(text);

      if (parsed) {
        setThresholds(parsed);
        setStatus("已读取当前阈值");
      } else {
        setStatus(`读取异常：${text}`);
      }
    } catch (err) {
      setStatus(`读取失败：${err.message}`);
    }
  }

  async function sendThresholds() {
    try {
      if (!ctrlChar) {
        setStatus("请先连接 BLE");
        return;
      }

      await ctrlChar.writeValue(encoder.encode(thresholdCommand));
      setStatus(`已发送：${thresholdCommand}`);

      setTimeout(() => {
        readThresholds();
      }, 300);
    } catch (err) {
      setStatus(`发送失败：${err.message}`);
    }
  }

  return (
    <div className="app">
      <div className="phone-shell">
        <div className="header card">
          <div>
            <div className="small-label">环境监测手机端</div>
            <h1>实时监测面板</h1>
            <div className="sub-text">最近更新：{data.updatedAt}</div>
          </div>
          <div className={`alarm-badge ${data.alarm ? "alarm-on" : "alarm-off"}`}>
            {data.alarm ? "报警中" : "正常"}
          </div>
        </div>

        <div className="card status-card">
          <div className="status-title">状态</div>
          <div className="status-text">{status}</div>
        </div>

        <div className="section-title">实时数据</div>
        <div className="grid">
          <MetricCard title="温度" value={data.temp.toFixed(1)} unit="°C" />
          <MetricCard title="湿度" value={data.humi.toFixed(1)} unit="%" />
          <MetricCard title="光照" value={data.lux} unit="lx" />
          <MetricCard title="噪声" value={data.noise} unit="raw" />
          <MetricCard title="气体" value={data.gas} unit="raw" />
          <MetricCard
            title="PM2.5"
            value={data.pm25.toFixed(1)}
            unit="rel"
            highlight={data.pm25 >= thresholds.pm25Warn}
          />
        </div>

        <div className="section-title">BLE 连接</div>
        <div className="card actions">
          <button onClick={connectBle} disabled={!supportBle || bleConnected}>
            连接 BLE
          </button>
          <button className="secondary" onClick={disconnectBle} disabled={!bleConnected}>
            断开 BLE
          </button>
          <button className="secondary" onClick={readThresholds} disabled={!bleConnected}>
            读取阈值
          </button>
        </div>

        <div className="card">
          <div className="row">
            <span>Web Bluetooth</span>
            <strong>{supportBle ? "支持" : "不支持"}</strong>
          </div>
          <div className="row">
            <span>BLE 状态</span>
            <strong>{bleConnected ? "已连接" : "未连接"}</strong>
          </div>
          <div className="row">
            <span>Mock 自动演示</span>
            <label className="switch-line">
              <input
                type="checkbox"
                checked={autoMock}
                onChange={(e) => setAutoMock(e.target.checked)}
              />
              <span>{autoMock ? "开启" : "关闭"}</span>
            </label>
          </div>
        </div>

        <div className="section-title">报警阈值</div>
        <div className="card form-card">
          <label>
            气体阈值
            <input
              type="number"
              value={thresholds.gas}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, gas: Number(e.target.value) }))
              }
            />
          </label>

          <label>
            噪声阈值
            <input
              type="number"
              value={thresholds.noise}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, noise: Number(e.target.value) }))
              }
            />
          </label>

          <label>
            PM2.5 轻度阈值
            <input
              type="number"
              step="0.1"
              value={thresholds.pm25Warn}
              onChange={(e) =>
                setThresholds((prev) => ({
                  ...prev,
                  pm25Warn: Number(e.target.value),
                }))
              }
            />
          </label>

          <label>
            PM2.5 重度阈值
            <input
              type="number"
              step="0.1"
              value={thresholds.pm25Alarm}
              onChange={(e) =>
                setThresholds((prev) => ({
                  ...prev,
                  pm25Alarm: Number(e.target.value),
                }))
              }
            />
          </label>

          <div className="command-box">{thresholdCommand}</div>

          <button onClick={sendThresholds} disabled={!bleConnected}>
            发送阈值到 ESP32
          </button>
        </div>

        <div className="section-title">原始 BLE 数据</div>
        <div className="card payload-box">{lastPayload || "尚未收到 BLE 数据"}</div>

        <div className="footer-tip">
          提示：连接成功后，页面会实时读取 ESP32 的 BLE 数据，并可发送
          <code>SET,1800,1500,8,15</code> 这种阈值命令。
        </div>
      </div>
    </div>
  );
}