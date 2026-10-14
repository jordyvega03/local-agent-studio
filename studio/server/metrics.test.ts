import { describe, expect, it } from "vitest";
import { parseDockerMem, parseIoreg, parsePs, parseSwap, parseVmStat } from "./metrics.ts";

describe("parsers de métricas (salidas reales de macOS)", () => {
  it("vm_stat: activa + wired + comprimida", () => {
    const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    23708.
Pages active:                                 272083.
Pages wired down:                             145367.
Pages occupied by compressor:                 817804.`;
    expect(parseVmStat(out)).toBe((272083 + 145367 + 817804) * 16384);
    expect(parseVmStat("basura")).toBeNull();
  });

  it("sysctl vm.swapusage", () => {
    expect(parseSwap("total = 7168.00M  used = 6676.62M  free = 491.38M  (encrypted)"))
      .toEqual({ total: 7168 * 1024 ** 2, used: 6676.62 * 1024 ** 2 });
  });

  it("ioreg: uso y memoria de la GPU", () => {
    expect(parseIoreg('"Renderer Utilization %"=3,"Device Utilization %"=42,"In use system memory"=748126208'))
      .toEqual({ gpu: 42, gpuMem: 748126208 });
    expect(parseIoreg("")).toEqual({ gpu: null, gpuMem: null });
  });

  it("ps: agrupa por proceso conocido y se reconoce a sí mismo", () => {
    const out = [
      " 2644   1.5  19712 /Applications/Ollama.app/Contents/Resources/ollama",
      "19997  80.0 13145216 /Applications/Ollama.app/Contents/Resources/llama-server",
      " 4833   0.4 166336 /Applications/Docker.app/Contents/MacOS/com.docker.backend",
      "  999   2.0  50000 /opt/homebrew/bin/node",
      "  123   9.9   1000 /usr/bin/otra-cosa",
    ].join("\n");
    const g = parsePs(out, 999);
    expect(g.map((x) => x.name)).toEqual(["Ollama", "Docker (VM)", "AI Studio"]);
    expect(g[0]).toMatchObject({ cpu: 81.5, count: 2, rss: (19712 + 13145216) * 1024 });
  });

  it("docker stats MemUsage", () => {
    expect(parseDockerMem("512MiB / 2GiB")).toEqual([512 * 1024 ** 2, 2 * 1024 ** 3]);
    expect(parseDockerMem("1.5GiB / 2GiB")).toEqual([1.5 * 1024 ** 3, 2 * 1024 ** 3]);
  });
});
