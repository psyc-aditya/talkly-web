// Smart Emoji Parser & Screen Effect Classifier for every Unicode emoji

const EMOJI_REGEX =
  /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;

export function extractEmojis(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.slice(0, 12) : [];
}

export function isEmojiOnlyMessage(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const emojis = extractEmojis(trimmed);
  if (emojis.length === 0 || emojis.length > 4) return false;
  const withoutEmojis = trimmed.replace(EMOJI_REGEX, "").replace(/[\s\uFE0F\u200D]/g, "");
  return withoutEmojis.length === 0;
}

const EFFECT_PROFILES = [
  {
    id: "love",
    match: ["❤️", "❤", "🧡", "💛", "💚", "💙", "💜", "🩷", "🩵", "🤍", "💖", "💗", "💓", "💞", "💕", "💘", "💝", "🫶", "😍", "🥰", "😘", "😗", "😙", "😚", "😻", "💑", "💏", "🌹", "🌷", "💋"],
    motion: "floatUp",
    ambientLight: "radial-gradient(circle at 50% 85%, rgba(244, 63, 94, 0.16), transparent 68%)",
    ambientDark: "radial-gradient(circle at 50% 85%, rgba(244, 63, 94, 0.22), transparent 68%)",
    sparks: ["#f43f5e", "#fb7185", "#fda4af", "#f472b6"],
    extras: ["✨", "💕"],
    shake: false,
    count: 26,
    durationMs: 2800,
  },
  {
    id: "celebrate",
    match: ["🎉", "🎊", "🥳", "🎈", "🎂", "🍰", "🎁", "🏆", "🥇", "🥈", "🥉", "🎆", "🎇", "🍾", "🥂", "🙌", "👏", "🎯", "👑"],
    motion: "confettiBurst",
    ambientLight: "radial-gradient(circle at 50% 75%, rgba(59, 130, 246, 0.14), transparent 70%)",
    ambientDark: "radial-gradient(circle at 50% 75%, rgba(56, 189, 248, 0.18), transparent 70%)",
    sparks: ["#3b82f6", "#38bdf8", "#34d399", "#a78bfa", "#f472b6", "#fde047"],
    extras: ["✨", "🎊"],
    shake: false,
    count: 34,
    durationMs: 3000,
  },
  {
    id: "laugh",
    match: ["😂", "🤣", "😆", "😄", "😃", "😁", "😹", "😜", "😝", "🤪", "🤭", "😊", "😇", "😉", "😋", "🥳"],
    motion: "bouncyPop",
    ambientLight: "radial-gradient(circle at 50% 80%, rgba(14, 165, 233, 0.13), transparent 68%)",
    ambientDark: "radial-gradient(circle at 50% 80%, rgba(56, 189, 248, 0.18), transparent 68%)",
    sparks: ["#38bdf8", "#60a5fa", "#818cf8", "#34d399"],
    extras: ["✨"],
    shake: false,
    count: 22,
    durationMs: 2500,
  },
  {
    id: "fire",
    match: ["🔥", "💥", "⚡", "💣", "🌶️", "🌶", "💯", "🚀", "☄️", "☄", "🌋", "🤯", "💪", "👊", "🥊"],
    motion: "rocketRise",
    ambientLight: "radial-gradient(circle at 50% 90%, rgba(239, 68, 68, 0.14), transparent 68%)",
    ambientDark: "radial-gradient(circle at 50% 90%, rgba(248, 113, 113, 0.2), transparent 68%)",
    sparks: ["#ef4444", "#f87171", "#38bdf8", "#fde047"],
    extras: ["✨", "⚡"],
    shake: true,
    count: 26,
    durationMs: 2500,
  },
  {
    id: "rain",
    match: ["😢", "😭", "🥺", "💔", "😔", "😞", "😟", "😥", "😓", "🌧️", "🌧", "☔", "💧", "💦", "🌊", "⛈️", "⛈", "😿"],
    motion: "rainFall",
    ambientLight: "radial-gradient(circle at 50% 15%, rgba(59, 130, 246, 0.14), transparent 72%)",
    ambientDark: "radial-gradient(circle at 50% 15%, rgba(56, 189, 248, 0.18), transparent 72%)",
    sparks: ["#60a5fa", "#93c5fd", "#38bdf8", "#bae6fd"],
    extras: ["💧"],
    shake: false,
    count: 28,
    durationMs: 2800,
  },
  {
    id: "snow",
    match: ["❄️", "❄", "⛄", "☃️", "☃", "🥶", "🧊", "🌨️", "🌨"],
    motion: "snowDrift",
    ambientLight: "radial-gradient(circle at 50% 10%, rgba(125, 211, 252, 0.22), transparent 75%)",
    ambientDark: "radial-gradient(circle at 50% 10%, rgba(186, 230, 253, 0.18), transparent 75%)",
    sparks: ["#bae6fd", "#e0f2fe", "#7dd3fc", "#ffffff"],
    extras: ["❄️"],
    shake: false,
    count: 30,
    durationMs: 3200,
  },
  {
    id: "angry",
    match: ["😡", "🤬", "😠", "😤", "💢", "👿", "😈", "😱", "💀", "☠️", "☠"],
    motion: "radialShock",
    ambientLight: "radial-gradient(circle at 50% 50%, rgba(220, 38, 38, 0.14), transparent 70%)",
    ambientDark: "radial-gradient(circle at 50% 50%, rgba(239, 68, 68, 0.22), transparent 70%)",
    sparks: ["#ef4444", "#f87171", "#94a3b8"],
    extras: ["💢"],
    shake: true,
    count: 22,
    durationMs: 2200,
  },
  {
    id: "magic",
    match: ["✨", "⭐", "🌟", "💫", "🪄", "🔮", "💎", "👍", "👌", "✌️", "✌", "🤝", "😎", "🤩", "🙏", "🫡", "🤍"],
    motion: "starOrbit",
    ambientLight: "radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.14), transparent 70%)",
    ambientDark: "radial-gradient(circle at 50% 50%, rgba(96, 165, 250, 0.2), transparent 70%)",
    sparks: ["#38bdf8", "#60a5fa", "#a5f3fc", "#818cf8", "#e0f2fe"],
    extras: ["✨", "⭐"],
    shake: false,
    count: 24,
    durationMs: 2600,
  },
  {
    id: "night",
    match: ["😴", "💤", "🌙", "🌛", "🌜", "🌌", "🥱", "😌", "🧘", "🛌", "🌠"],
    motion: "dreamyDrift",
    ambientLight: "radial-gradient(circle at 50% 20%, rgba(99, 102, 241, 0.14), transparent 72%)",
    ambientDark: "radial-gradient(circle at 50% 20%, rgba(129, 140, 248, 0.22), transparent 72%)",
    sparks: ["#818cf8", "#a5b4fc", "#c4b5fd", "#e0e7ff"],
    extras: ["✨", "💤"],
    shake: false,
    count: 20,
    durationMs: 3200,
  },
  {
    id: "music",
    match: ["🎵", "🎶", "🎧", "🎤", "💃", "🕺", "🎸", "🎹", "🥁", "🎺", "🎻", "🪩"],
    motion: "waveDance",
    ambientLight: "radial-gradient(circle at 50% 60%, rgba(139, 92, 246, 0.14), transparent 70%)",
    ambientDark: "radial-gradient(circle at 50% 60%, rgba(167, 139, 250, 0.2), transparent 70%)",
    sparks: ["#8b5cf6", "#38bdf8", "#ec4899", "#60a5fa"],
    extras: ["🎵", "🎶"],
    shake: false,
    count: 24,
    durationMs: 2800,
  },
  {
    id: "nature",
    match: ["🌸", "🌺", "🌻", "🌼", "🍀", "🌿", "🍃", "🍂", "🍁", "🦋", "🌈", "☀️", "☀", "🌤️", "🌴", "🌱"],
    motion: "petalGlide",
    ambientLight: "radial-gradient(circle at 50% 35%, rgba(52, 211, 153, 0.14), transparent 70%)",
    ambientDark: "radial-gradient(circle at 50% 35%, rgba(52, 211, 153, 0.18), transparent 70%)",
    sparks: ["#34d399", "#6ee7b7", "#38bdf8", "#f9a8d4"],
    extras: ["✨"],
    shake: false,
    count: 24,
    durationMs: 3000,
  },
];

const FALLBACK_PROFILE = {
  id: "universal",
  motion: "smartCascade",
  ambientLight: "radial-gradient(circle at 50% 70%, rgba(59, 130, 246, 0.12), transparent 70%)",
  ambientDark: "radial-gradient(circle at 50% 70%, rgba(56, 189, 248, 0.16), transparent 70%)",
  sparks: ["#3b82f6", "#38bdf8", "#818cf8", "#34d399"],
  extras: ["✨"],
  shake: false,
  count: 22,
  durationMs: 2500,
};

export function createEmojiEffectPayload(text, origin = "outgoing") {
  const emojis = extractEmojis(text);
  if (emojis.length === 0) return null;

  let matchedProfile = null;
  for (const emoji of emojis) {
    const normalized = emoji.replace(/\uFE0F/g, "");
    for (const profile of EFFECT_PROFILES) {
      if (profile.match.some((m) => m === emoji || m.replace(/\uFE0F/g, "") === normalized)) {
        matchedProfile = profile;
        break;
      }
    }
    if (matchedProfile) break;
  }

  const profile = matchedProfile || FALLBACK_PROFILE;
  const uniqueEmojis = Array.from(new Set(emojis)).slice(0, 4);

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    emojis: uniqueEmojis,
    origin, // 'outgoing' (right-bottom) | 'incoming' (left-bottom)
    ...profile,
  };
}
