import { createContext, useContext } from 'react';
import type { Lang } from './i18n';

/** Current UI language for shared components (screens still receive `lang` explicitly). */
export const LangContext = createContext<Lang>('ar');
export const useLang = () => useContext(LangContext);
