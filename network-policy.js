const net = require("net");

const DEFAULT_ADMIN_ALLOWED_SUBNETS = [
  "127.0.0.1/32",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "::1/128",
];

function normalizeIpAddress(value) {
  if (!value) return "";
  let ip = String(value).trim();
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) {
    return ip.slice(7);
  }
  return ip;
}

function parseAdminAllowedSubnets(value) {
  if (Array.isArray(value)) {
    const items = value.map((entry) => String(entry || "").trim()).filter(Boolean);
    return items.length ? items : DEFAULT_ADMIN_ALLOWED_SUBNETS.slice();
  }

  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length ? items : DEFAULT_ADMIN_ALLOWED_SUBNETS.slice();
}

function ipv4ToBigInt(ip) {
  return ip.split(".").reduce((result, octet) => (result << 8n) + BigInt(Number.parseInt(octet, 10)), 0n);
}

function ipv6ToBigInt(ip) {
  const normalized = normalizeIpAddress(ip);
  const parts = normalized.split("::");
  if (parts.length > 2) throw new Error(`IPv6 invalide: ${ip}`);

  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missingGroups = 8 - (head.length + tail.length);

  if (missingGroups < 0) throw new Error(`IPv6 invalide: ${ip}`);

  const groups = [
    ...head,
    ...Array.from({ length: missingGroups }, () => "0"),
    ...tail,
  ];

  if (groups.length !== 8) throw new Error(`IPv6 invalide: ${ip}`);

  return groups.reduce((result, group) => (result << 16n) + BigInt(Number.parseInt(group || "0", 16)), 0n);
}

function ipToBigInt(ip, version) {
  return version === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
}

function parseSubnet(entry) {
  const raw = String(entry || "").trim();
  if (!raw) return null;

  const [addressPart, prefixPart] = raw.split("/");
  const address = normalizeIpAddress(addressPart);
  const version = net.isIP(address);
  if (!version) return null;

  const totalBits = version === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? totalBits : Number.parseInt(prefixPart, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) return null;

  const bits = BigInt(totalBits);
  const hostBits = BigInt(totalBits - prefix);
  const allOnes = (1n << bits) - 1n;
  const mask = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
  const value = ipToBigInt(address, version);

  return {
    raw,
    address,
    version,
    prefix,
    mask,
    network: value & mask,
  };
}

function isIpAllowed(ip, allowedSubnets) {
  const normalized = normalizeIpAddress(ip);
  const version = net.isIP(normalized);
  if (!version) return false;

  const value = ipToBigInt(normalized, version);
  return allowedSubnets.some((subnet) => subnet.version === version && (value & subnet.mask) === subnet.network);
}

function createNetworkPolicy({ adminAllowedSubnets } = {}) {
  const rawSubnets = parseAdminAllowedSubnets(adminAllowedSubnets);
  const parsedSubnets = rawSubnets.map(parseSubnet).filter(Boolean);

  function getRequestIp(req) {
    return normalizeIpAddress(
      req?.socket?.remoteAddress ||
      req?.connection?.remoteAddress ||
      req?.ip ||
      ""
    );
  }

  function getSocketIp(socketLike) {
    return normalizeIpAddress(
      socketLike?.socket?.remoteAddress ||
      socketLike?.connection?.remoteAddress ||
      socketLike?._socket?.remoteAddress ||
      ""
    );
  }

  function isAdminNetworkAllowed(ipOrReq) {
    const ip = typeof ipOrReq === "string" ? normalizeIpAddress(ipOrReq) : getRequestIp(ipOrReq);
    return isIpAllowed(ip, parsedSubnets);
  }

  return {
    getAdminAllowedSubnets() {
      return rawSubnets.slice();
    },
    describeAdminPolicy() {
      return rawSubnets.join(", ");
    },
    getRequestIp,
    getSocketIp,
    isAdminNetworkAllowed,
  };
}

module.exports = {
  DEFAULT_ADMIN_ALLOWED_SUBNETS,
  createNetworkPolicy,
  normalizeIpAddress,
  parseAdminAllowedSubnets,
};
