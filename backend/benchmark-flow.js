#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const reportPath = join(rootDir, 'reports', 'flow-benchmark-20260429.md');

const scenarios = [
  {
    id: 'happy-new-delivery',
    name: 'Happy path - new customer, delivery',
    description: 'Customer baru mulai dari sapaan umum lalu pesan kopsu 2 sampai QRIS.',
    customerMessages: ['halo', 'kopsu 2', 'Rasyid', 'iya', 'delivery', 'shareloc', 'QRIS'],
    expectedBehavior: [
      'Sapa singkat tanpa tanya nama di awal, lalu minta pesanan.',
      'Konfirmasi item + total lalu tanya nama pada Step 2.',
      'Setelah nama masuk, tunggu persetujuan sebelum lanjut.',
      'Tanya fulfillment lalu minta shareloc untuk delivery.',
      'Hitung ongkir, tampilkan total akhir, lalu tawarkan QRIS/COD.',
      'Saat pilih QRIS: write state + sync, tanpa reply tambahan (NO_REPLY).'
    ],
    idealSteps: 7,
    currentSteps: 7,
    toneMatch: 4,
    frictionPoints: [
      'Nama baru dikumpulkan setelah item, jadi ada jeda ekstra sebelum fulfillment.',
      'Delivery wajib shareloc; kalau customer belum siap, flow gampang kepotong.'
    ],
    beforeScore: 4,
    afterScore: 5,
    improvements: [
      'Deteksi nama kalau customer menyebutkannya lebih awal di pesan kedua.',
      'Gunakan microcopy transisional yang lebih ringkas saat pindah ke shareloc.'
    ]
  },
  {
    id: 'happy-returning-customer',
    name: 'Happy path - returning customer',
    description: 'Customer lama dengan preferredFulfillment delivery harus dapat suggestion yang relevan.',
    customerMessages: ['halo', 'kopsu lagi 1', 'iya', 'iya', 'shareloc', 'COD'],
    expectedBehavior: [
      'Baca profile sekali, sapa pakai nama kalau ada.',
      'Konfirmasi item dengan nama pada summary.',
      'Di Step 4, tawarkan: "Delivery lagi kak, atau mau pickup/dine-in?"',
      'Kalau customer jawab "iya", langsung lanjut ke shareloc.',
      'Setelah ongkir, tawarkan QRIS/COD.',
      'Saat pilih COD: write state + sync + reply COD.'
    ],
    idealSteps: 6,
    currentSteps: 6,
    toneMatch: 5,
    frictionPoints: [
      'Suggestion fulfillment cuma jalan kalau preferredFulfillment valid dan profile rapi.',
      'Balasan "iya" bisa ambigu kalau sebelumnya bukan pertanyaan suggestion.'
    ],
    beforeScore: 4,
    afterScore: 5,
    improvements: [
      'Tambahkan parser konteks untuk menangkap "iya" sebagai konfirmasi suggestion.',
      'Mention pesanan favorit singkat untuk memperkuat tone returning customer.'
    ]
  },
  {
    id: 'one-shot-pickup',
    name: 'One-shot order - kopsu 2 pickup',
    description: 'Customer kasih item + qty + fulfillment sekaligus, jadi bot harus lompat step.',
    customerMessages: ['kopsu 2 pickup', 'Bimo', 'iya'],
    expectedBehavior: [
      'Tangkap item dan pickup dalam satu parsing.',
      'Konfirmasi item + total dan tanya nama di Step 2.',
      'Setelah nama dan approval, skip Step 4 serta skip pertanyaan payment umum.',
      'Langsung set pickup = QRIS only, lalu write state + sync tanpa nanya COD.'
    ],
    idealSteps: 3,
    currentSteps: 3,
    toneMatch: 5,
    frictionPoints: [
      'Kalau parser one-shot miss kata pickup, customer terlempar ke flow biasa dan nambah 1 step.',
      'Masih butuh approval eksplisit walau intent customer sudah sangat jelas.'
    ],
    beforeScore: 5,
    afterScore: 5,
    improvements: [
      'Tidak mendesak; flow ini sudah efisien.'
    ]
  },
  {
    id: 'quick-reorder',
    name: 'Quick reorder',
    description: 'Customer minta pesanan yang sama seperti kemarin.',
    customerMessages: ['pesan lagi kayak kemarin', 'iya', 'delivery', 'shareloc', 'QRIS'],
    expectedBehavior: [
      'Jalankan order-history.js 1.',
      'Rangkum order terakhir dengan natural lalu tanya apakah mau sama.',
      'Kalau iya, lompat ke Step 2 tanpa re-capture item manual.',
      'Lanjut fulfillment, ongkir, lalu payment seperti flow biasa.'
    ],
    idealSteps: 5,
    currentSteps: 5,
    toneMatch: 4,
    frictionPoints: [
      'Kalau riwayat kosong, flow mental model customer langsung patah dan harus restart dari nol.',
      'Jika item lama sekarang unavailable, perlu fallback yang belum dijabarkan detail.'
    ],
    beforeScore: 4,
    afterScore: 5,
    improvements: [
      'Tambahkan fallback otomatis saat item riwayat unavailable: tawarkan item serupa.',
      'Sertakan total lama supaya customer lebih cepat validasi.'
    ]
  },
  {
    id: 'dine-in-qr-scan',
    name: 'Dine-in QR scan',
    description: 'Customer scan QR dari meja dan menyebut nomor meja di pesan pertama.',
    customerMessages: ['Halo Kang Ngupi, saya di meja 5 nih!', 'mau lihat menu dulu', '15', 'kopsu 1', 'Ayu', 'udah', 'QRIS'],
    expectedBehavior: [
      'Jangan baca customer profile dan jangan tanya nama di pembuka.',
      'Balas persis template meja + tawaran pesan atau lihat menu.',
      'Kalau customer minta menu, baru tampilkan daftar kategori.',
      'Setelah order, tanya nama di konfirmasi Step 2 bila belum ada.',
      'Karena dine-in open bill, tanya "mau nambah lagi atau udah kak?" sebelum payment.',
      'Setelah pilih QRIS, write state + sync tanpa chat tambahan.'
    ],
    idealSteps: 7,
    currentSteps: 7,
    toneMatch: 4,
    frictionPoints: [
      'Template pembuka harus persis; ruang improvisasi tone jadi sempit.',
      'Dine-in open bill menambah satu keputusan ekstra sebelum pembayaran.'
    ],
    beforeScore: 4,
    afterScore: 4,
    improvements: [
      'Boleh siapkan template meja yang tetap compliant tapi terasa lebih hangat.',
      'Tambahkan shortcut "langsung bayar" bila customer jelas tidak ingin tambah item.'
    ]
  },
  {
    id: 'menu-browsing',
    name: 'Menu browsing',
    description: 'Customer minta lihat menu, pilih kategori, lalu order dari hasil browse.',
    customerMessages: ['lihat menu dong', '14', 'chicken katsu 1', 'Nina', 'iya', 'pickup'],
    expectedBehavior: [
      'Tampilkan daftar kategori statis dulu.',
      'Saat customer pilih nomor kategori, baru baca menu-schema dan kirim subset item kategori.',
      'Kalau item punya varian, tanyakan hanya varian yang relevan.',
      'Lanjut ke konfirmasi, nama, approval, fulfillment, lalu payment sesuai aturan pickup.'
    ],
    idealSteps: 6,
    currentSteps: 7,
    toneMatch: 4,
    frictionPoints: [
      'Browsing kategori hampir pasti nambah satu roundtrip dibanding direct order.',
      'Jika item punya varian wajib, step bisa membengkak lagi sebelum konfirmasi final.'
    ],
    beforeScore: 3,
    afterScore: 4,
    improvements: [
      'Saat kirim kategori, tambahkan contoh best-seller per kategori untuk bantu discovery.',
      'Gunakan numbered quick picks pada hasil kategori supaya customer tinggal balas angka/item.'
    ]
  },
  {
    id: 'mid-flow-modification',
    name: 'Mid-flow modification',
    description: 'Customer mengubah item setelah sempat dikonfirmasi.',
    customerMessages: ['kopsu 2', 'Raka', 'eh ganti 1 aja deh', 'iya', 'pickup'],
    expectedBehavior: [
      'Setelah perubahan, update cart lalu kembali ke Step 2.',
      'Kirim ulang summary terbaru dengan nama dan total yang benar.',
      'Jangan lanjut fulfillment sampai customer setuju lagi.',
      'Setelah approval baru lanjut ke pickup/QRIS flow.'
    ],
    idealSteps: 5,
    currentSteps: 6,
    toneMatch: 4,
    frictionPoints: [
      'Harus konfirmasi ulang penuh; aman tapi menambah 1 step.',
      'Kalau customer sering revisi kecil, flow bisa terasa repetitif.'
    ],
    beforeScore: 3,
    afterScore: 4,
    improvements: [
      'Boleh pakai konfirmasi delta singkat: "sip, jadi kopsu 1 ya" sebelum summary final.',
      'Tahan generation order ID sampai perubahan benar-benar selesai.'
    ]
  },
  {
    id: 'outside-hours',
    name: 'Edge case - outside hours',
    description: 'Customer order jam 11 malam, tetap diterima tapi harus dikasih ekspektasi.',
    customerMessages: ['halo, mau pesan kopsu 1 delivery', 'Dina', 'iya', 'shareloc', 'COD'],
    expectedBehavior: [
      'Di awal flow order, kasih notice toko tutup satu kali saja.',
      'Setelah itu lanjut normal tanpa mengulang reminder tutup.',
      'Karena one-shot sudah menyebut delivery, skip tanya fulfillment dan langsung ke shareloc.',
      'Selesaikan payment seperti biasa.'
    ],
    idealSteps: 5,
    currentSteps: 5,
    toneMatch: 5,
    frictionPoints: [
      'Butuh check-hours akurat; kalau tidak, risk salah kasih ekspektasi.',
      'Notice tutup menambah beban baca di pembuka yang sudah memuat order intent.'
    ],
    beforeScore: 4,
    afterScore: 5,
    improvements: [
      'Gabungkan notice tutup + acknowledgement order dalam satu balasan singkat.',
      'Cache status jam buka per sesi agar tidak perlu cek berulang.'
    ]
  },
  {
    id: 'unavailable-item',
    name: 'Edge case - unavailable item',
    description: 'Customer memesan item yang ada di menu-schema tapi stoknya unavailable.',
    customerMessages: ['mau pesan avocado coffee 1'],
    expectedBehavior: [
      'Baca menu-schema karena item bukan alias.',
      'Cek field available.',
      'Kalau false, balas bahwa item lagi tidak tersedia.',
      'Idealnya tawarkan alternatif relevan tanpa memaksa.'
    ],
    idealSteps: 2,
    currentSteps: 2,
    toneMatch: 3,
    frictionPoints: [
      'AGENTS.md mewajibkan penolakan availability, tapi belum eksplisit mewajibkan rekomendasi alternatif.',
      'Kalau cuma bilang unavailable, conversion gampang drop.'
    ],
    beforeScore: 2,
    afterScore: 4,
    improvements: [
      'Tambahkan fallback rekomendasi 1-2 item terdekat secara kategori/harga.',
      'Simpan daftar substitusi populer supaya respons tetap cepat.'
    ]
  },
  {
    id: 'ambiguous-order',
    name: 'Ambiguous order - kopi 1',
    description: 'Customer menyebut kategori umum, bukan item spesifik.',
    customerMessages: ['kopi 1'],
    expectedBehavior: [
      'Jangan menebak item.',
      'Klarifikasi singkat jenis kopi yang dimaksud, misalnya kopsu/americano/latte.',
      'Setelah customer pilih, baru masuk Step 1 normal.'
    ],
    idealSteps: 2,
    currentSteps: 2,
    toneMatch: 4,
    frictionPoints: [
      'Perlu ekstra roundtrip karena intent belum spesifik.',
      'Tanpa opsi cepat, klarifikasi bisa terlalu terbuka dan bikin customer mikir lama.'
    ],
    beforeScore: 3,
    afterScore: 4,
    improvements: [
      'Klarifikasi pakai 2-3 opsi contoh plus harga supaya customer cepat pilih.',
      'Prioritaskan alias populer dulu daripada pertanyaan terbuka penuh.'
    ]
  }
];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scenarioMetrics(scenario) {
  const frictionPenalty = Math.max(0, scenario.frictionPoints.length - 1) * 0.25;
  const stepEfficiency = Math.max(1, 5 - Math.max(0, scenario.currentSteps - scenario.idealSteps) - frictionPenalty);
  const overall = Number(((scenario.beforeScore + scenario.toneMatch + stepEfficiency) / 3).toFixed(1));
  return {
    ...scenario,
    stepEfficiency: Number(stepEfficiency.toFixed(1)),
    overallScore: overall,
    improvementDelta: scenario.afterScore - scenario.beforeScore
  };
}

const scored = scenarios.map(scenarioMetrics);
const overallFlowScore = Number(average(scored.map((s) => s.beforeScore)).toFixed(1));
const projectedFlowScore = Number(average(scored.map((s) => s.afterScore)).toFixed(1));

const frictionCounts = new Map();
for (const scenario of scored) {
  for (const point of scenario.frictionPoints) {
    const key = point.replace(/\.$/, '');
    frictionCounts.set(key, (frictionCounts.get(key) || 0) + 1);
  }
}

const topFrictionPoints = [...frictionCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 8);

const recommendations = [
  {
    title: 'Tambahkan fallback alternatif untuk item unavailable dan reorder yang mentok stok',
    impact: 'Tinggi',
    rationale: 'Menutup titik drop terbesar di scenario unavailable-item dan quick-reorder.',
    affects: ['unavailable-item', 'quick-reorder']
  },
  {
    title: 'Percepat klarifikasi dengan opsi cepat untuk intent ambigu dan browse kategori',
    impact: 'Tinggi',
    rationale: 'Mengurangi roundtrip ekstra saat customer belum spesifik atau masih cari-cari.',
    affects: ['menu-browsing', 'ambiguous-order']
  },
  {
    title: 'Bikin konfirmasi revisi yang lebih ringkas untuk mid-flow modification',
    impact: 'Sedang',
    rationale: 'Tetap aman, tapi mengurangi rasa repetitif saat customer edit pesanan.',
    affects: ['mid-flow-modification']
  },
  {
    title: 'Perkuat personalization untuk returning customer dengan parsing konfirmasi "iya" yang kontekstual',
    impact: 'Sedang',
    rationale: 'Biar smart suggestion benar-benar terasa mulus di chat nyata.',
    affects: ['happy-returning-customer']
  },
  {
    title: 'Satukan notice di luar jam buka dengan acknowledgement order',
    impact: 'Rendah',
    rationale: 'Mengurangi beban baca tanpa mengubah aturan operasional.',
    affects: ['outside-hours']
  }
];

function renderScenarioTable(rows) {
  return [
    '| Scenario | Ideal steps | Current steps | Flow score | Tone | Main friction |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((s) => `| ${s.name} | ${s.idealSteps} | ${s.currentSteps} | ${s.beforeScore}/5 | ${s.toneMatch}/5 | ${s.frictionPoints[0]} |`)
  ].join('\n');
}

function renderDetails(rows) {
  return rows.map((s, index) => {
    const messages = s.customerMessages.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const expected = s.expectedBehavior.map((m) => `- ${m}`).join('\n');
    const friction = s.frictionPoints.map((m) => `- ${m}`).join('\n');
    const improvements = s.improvements.map((m) => `- ${m}`).join('\n');
    return `### ${index + 1}. ${s.name}\n\n**Description**: ${s.description}\n\n**Simulated customer messages**\n${messages}\n\n**Expected bot behavior**\n${expected}\n\n**Benchmark**\n- Minimum steps needed (ideal): ${s.idealSteps}\n- Current steps needed: ${s.currentSteps}\n- Step efficiency: ${s.stepEfficiency}/5\n- Tone match: ${s.toneMatch}/5\n- Score: ${s.beforeScore}/5\n- Projected after improvements: ${s.afterScore}/5\n\n**Friction points**\n${friction}\n\n**Improvement ideas**\n${improvements}`;
  }).join('\n\n');
}

const report = `# Kang Ngupi Flow Benchmark — 2026-04-29\n\nGenerated by \`backend/benchmark-flow.js\` based on the current rules in \`AGENTS.md\` and voice guidance in \`SOUL.md\`.\n\n## Executive summary\n\n- Overall flow score (current): **${overallFlowScore}/5**\n- Projected score after recommended improvements: **${projectedFlowScore}/5**\n- Coverage: **${scored.length} scenarios** across happy path, accelerators, dine-in, browsing, and edge cases\n- Tone readout: strong on warmth/personalization, weaker when the flow is template-heavy or fallback logic is missing\n\n## Scenario scorecard\n\n${renderScenarioTable(scored)}\n\n## Top friction points\n\n${topFrictionPoints.map(([point, count], index) => `${index + 1}. ${point} _(seen in ${count} scenario${count > 1 ? 's' : ''})_`).join('\n')}\n\n## Before vs after improvements\n\n| Measure | Current | After improvements | Delta |\n| --- | ---: | ---: | ---: |\n| Average flow score | ${overallFlowScore}/5 | ${projectedFlowScore}/5 | +${(projectedFlowScore - overallFlowScore).toFixed(1)} |\n| Scenarios scoring 4-5 | ${scored.filter((s) => s.beforeScore >= 4).length}/${scored.length} | ${scored.filter((s) => s.afterScore >= 4).length}/${scored.length} | +${scored.filter((s) => s.afterScore >= 4).length - scored.filter((s) => s.beforeScore >= 4).length} |\n| Lowest scenario score | ${Math.min(...scored.map((s) => s.beforeScore))}/5 | ${Math.min(...scored.map((s) => s.afterScore))}/5 | +${Math.min(...scored.map((s) => s.afterScore)) - Math.min(...scored.map((s) => s.beforeScore))} |\n\n## Ranked recommendations\n\n${recommendations.map((r, index) => `${index + 1}. **${r.title}** — impact: **${r.impact}**  \n   ${r.rationale}  \n   Affects: ${r.affects.join(', ')}`).join('\n\n')}\n\n## Scenario details\n\n${renderDetails(scored)}\n`;

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report);

console.log(JSON.stringify({
  reportPath,
  overallFlowScore,
  projectedFlowScore,
  scenarios: scored.map(({ id, name, beforeScore, afterScore, idealSteps, currentSteps }) => ({
    id,
    name,
    beforeScore,
    afterScore,
    idealSteps,
    currentSteps
  }))
}, null, 2));
