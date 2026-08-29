import { describe, it, expect } from "vitest";
import http from "http";
import { isPrivateIpAddress, isSafeDownloadUrl, safeFetch } from "../src/bot/urlSafety.js";

describe("isPrivateIpAddress", () => {
  it("detects private IPv4 ranges", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.5")).toBe(true);
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.1")).toBe(true);
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("100.64.0.1")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateIpAddress("172.32.0.1")).toBe(false);
  });

  it("detects private IPv6 addresses", () => {
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateIpAddress("fe80::1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("isSafeDownloadUrl", () => {
  it("blocks private and loopback destinations without DNS", async () => {
    expect(await isSafeDownloadUrl("http://127.0.0.1:8080/secret")).toBe(false);
    expect(await isSafeDownloadUrl("http://10.0.0.1/")).toBe(false);
    expect(await isSafeDownloadUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(await isSafeDownloadUrl("http://192.168.1.10/x")).toBe(false);
    expect(await isSafeDownloadUrl("http://[::1]/x")).toBe(false);
  });

  it("blocks non-http protocols and local hostnames", async () => {
    expect(await isSafeDownloadUrl("ftp://example.com/file")).toBe(false);
    expect(await isSafeDownloadUrl("file:///etc/passwd")).toBe(false);
    expect(await isSafeDownloadUrl("http://localhost:3000/x")).toBe(false);
    expect(await isSafeDownloadUrl("http://myserver.internal/x")).toBe(false);
    expect(await isSafeDownloadUrl("not a url")).toBe(false);
  });

  it("allows public https destinations (DNS resolution)", async () => {
    expect(await isSafeDownloadUrl("https://example.com/file.mp4")).toBe(true);
  });
});

describe("safeFetch", () => {
  it("refuses to fetch private destinations", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    await expect(safeFetch(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/Blocked unsafe URL/);

    server.close();
  });
});
