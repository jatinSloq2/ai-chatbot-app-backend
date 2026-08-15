// Minimal i18n for the widget UI + AI system-prompt language instruction.
// Not exhaustive — covers the strings the widget actually renders itself
// (everything else, like the AI's own replies, is handled by instructing
// the model to answer in the visitor's chosen language).

const LANGUAGE_NAMES = {
  en: "English",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
  ru: "Russian",
};

const DEFAULT_STRINGS = {
  inputPlaceholder: "Type a message...",
  send: "Send",
  talkToHuman: "Talk to a human agent",
  connecting: "Connecting...",
  connectingAgent: "Connecting you with an agent...",
  agentJoined: "An agent has joined the chat.",
  chatResolved: "This chat has been marked resolved.",
  rateChat: "How was your chat?",
  ratingThanks: "Thanks for your feedback!",
  attachFile: "Attach a file",
  poweredBy: "Powered by",
  selectLanguage: "Language",
};

const STRINGS = {
  en: DEFAULT_STRINGS,
  hi: {
    inputPlaceholder: "अपना संदेश लिखें...",
    send: "भेजें",
    talkToHuman: "किसी एजेंट से बात करें",
    connecting: "कनेक्ट हो रहा है...",
    connectingAgent: "आपको एक एजेंट से जोड़ा जा रहा है...",
    agentJoined: "एक एजेंट चैट में शामिल हो गया है।",
    chatResolved: "यह चैट हल कर दी गई है।",
    rateChat: "आपकी चैट कैसी रही?",
    ratingThanks: "आपकी प्रतिक्रिया के लिए धन्यवाद!",
    attachFile: "फ़ाइल संलग्न करें",
    poweredBy: "द्वारा संचालित",
    selectLanguage: "भाषा",
  },
  es: {
    inputPlaceholder: "Escribe un mensaje...",
    send: "Enviar",
    talkToHuman: "Hablar con un agente",
    connecting: "Conectando...",
    connectingAgent: "Te estamos conectando con un agente...",
    agentJoined: "Un agente se ha unido al chat.",
    chatResolved: "Este chat ha sido marcado como resuelto.",
    rateChat: "¿Cómo estuvo tu chat?",
    ratingThanks: "¡Gracias por tu opinión!",
    attachFile: "Adjuntar archivo",
    poweredBy: "Desarrollado por",
    selectLanguage: "Idioma",
  },
  fr: {
    inputPlaceholder: "Écrivez un message...",
    send: "Envoyer",
    talkToHuman: "Parler à un agent",
    connecting: "Connexion...",
    connectingAgent: "Nous vous mettons en relation avec un agent...",
    agentJoined: "Un agent a rejoint la conversation.",
    chatResolved: "Cette conversation a été marquée comme résolue.",
    rateChat: "Comment s'est passée votre conversation ?",
    ratingThanks: "Merci pour votre retour !",
    attachFile: "Joindre un fichier",
    poweredBy: "Propulsé par",
    selectLanguage: "Langue",
  },
  de: {
    inputPlaceholder: "Nachricht eingeben...",
    send: "Senden",
    talkToHuman: "Mit einem Mitarbeiter sprechen",
    connecting: "Verbinde...",
    connectingAgent: "Sie werden mit einem Mitarbeiter verbunden...",
    agentJoined: "Ein Mitarbeiter ist dem Chat beigetreten.",
    chatResolved: "Dieser Chat wurde als gelöst markiert.",
    rateChat: "Wie war Ihr Chat?",
    ratingThanks: "Danke für Ihr Feedback!",
    attachFile: "Datei anhängen",
    poweredBy: "Bereitgestellt von",
    selectLanguage: "Sprache",
  },
};

const getStrings = (langCode) => ({ ...DEFAULT_STRINGS, ...(STRINGS[langCode] || {}) });

const getLanguageName = (langCode) => LANGUAGE_NAMES[langCode] || langCode;

module.exports = { LANGUAGE_NAMES, getStrings, getLanguageName };