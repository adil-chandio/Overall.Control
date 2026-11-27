export interface Chapter {
  id: string;
  label: string;
  start: number; // seconds
  dur: number;
  captions: { t: number; ur: string; en: string }[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: "raat",
    label: "Chapter 1 · Raat ka Samundar",
    start: 0,
    dur: 16,
    captions: [
      { t: 1, ur: "Raat ka samundar... chand ki roshni pani pe chamak rahi hai.", en: "The night sea... moonlight shimmering on the water." },
      { t: 8, ur: "Ek chhoti si naav, tanha, sannate mein khoi hui.", en: "A small boat, alone, lost in the silence." },
    ],
  },
  {
    id: "dive",
    label: "Chapter 2 · The Dive",
    start: 16,
    dur: 16,
    captions: [
      { t: 1, ur: "Pani upar se girta hai... hum utarte ja rahe hain.", en: "Water falls from above... we descend." },
      { t: 9, ur: "God rays — roshni ki kirnein gehraee mein.", en: "God rays — beams of light into the deep." },
    ],
  },
  {
    id: "pressure",
    label: "Chapter 3 · Pressure",
    start: 32,
    dur: 16,
    captions: [
      { t: 1, ur: " Gehraee badh rahi hai... 400 meter.", en: "The depth is rising... 400 meters." },
      { t: 8, ur: "Dil ki dharkan tez ho gayi. Yahan kuch zinda hai.", en: "The heartbeat quickens. Something lives here." },
    ],
  },
  {
    id: "angler",
    label: "Chapter 4 · Andhere ka Shikari",
    start: 48,
    dur: 18,
    captions: [
      { t: 1, ur: "Andhera... ek roshni. Anglerfish ka shikar shuru.", en: "Darkness... a single light. The anglerfish strikes." },
      { t: 10, ur: "SLOW MOTION — waqt ruk sa gaya.", en: "SLOW MOTION — time itself has stopped." },
    ],
  },
  {
    id: "whale",
    label: "Chapter 5 · The Giant",
    start: 66,
    dur: 20,
    captions: [
      { t: 1, ur: "Kya woh... aik saaya hai? Blue whale.", en: "What is that... a shadow? A blue whale." },
      { t: 10, ur: "Sabse bara janwar, khamoshi se guzar gaya.", en: "The largest creature, passing in silence." },
    ],
  },
  {
    id: "abyss",
    label: "Chapter 6 · The Abyss",
    start: 86,
    dur: 18,
    captions: [
      { t: 1, ur: "1099 meter. Yahan roshni kabhi nahi pohanchi.", en: "1099 meters. Light has never reached here." },
      { t: 9, ur: "Bioluminescence — zameen ke neeche aik naya aasman.", en: "Bioluminescence — a new sky beneath the earth." },
    ],
  },
  {
    id: "jwalamukhi",
    label: "Chapter 7 · Jwalamukhi",
    start: 104,
    dur: 22,
    captions: [
      { t: 1, ur: "2300 meter. Andar se aag nikal rahi hai — aik underwater volcano.", en: "2300 meters. Fire from within — an underwater volcano." },
      { t: 12, ur: "Lava, dhuan, aur aag ka samundar. Yeh hai gehraee ka sach.", en: "Lava, smoke, and a sea of fire. This is the truth of the deep." },
    ],
  },
];

export const DURATION = CHAPTERS.reduce((a, c) => Math.max(a, c.start + c.dur), 0); // 126s

/** 0-based chapter lookup, clamped — safe at t === DURATION */
export function chapterIndexAt(t: number): number {
  const clamped = Math.min(Math.max(t, 0), DURATION - 1e-4);
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    if (clamped >= CHAPTERS[i].start) return i;
  }
  return 0;
}
