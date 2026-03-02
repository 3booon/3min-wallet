import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTrans from "./locales/en/translation.json";
import koTrans from "./locales/ko/translation.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTrans },
      ko: { translation: koTrans },
    },
    lng: "en", // default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

export default i18n;
