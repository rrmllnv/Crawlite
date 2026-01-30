import { useEffect } from 'react'
import { useUserConfig } from './useUserConfig'

export const useLocale = () => {
  const { getConfig, updateConfig } = useUserConfig()

  const applyLocale = (locale: string) => {
    document.documentElement.lang = locale
  }

  useEffect(() => {
    const loadLocale = async () => {
      try {
        const config = await getConfig()
        const locale = config?.app?.locale || 'ru'
        applyLocale(locale)
      } catch {
        applyLocale('ru')
      }
    }
    void loadLocale()
  }, [])

  const setLocale = async (locale: string) => {
    applyLocale(locale)
    const config = await getConfig()
    const browserViewLayout = (config?.app as any)?.browserViewLayout || { pagesColWidthPx: 320, detailsColWidthPx: 420 }
    const settingsViewLayout = (config?.app as any)?.settingsViewLayout || { sidebarColWidthPx: 260 }
    await updateConfig({
      app: {
        theme: config?.app?.theme || 'dark',
        locale,
        currentView: config?.app?.currentView || 'browser',
        browserViewLayout,
        settingsViewLayout,
      },
    })
  }

  return { setLocale }
}

