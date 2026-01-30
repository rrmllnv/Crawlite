import { useEffect } from 'react'
import { useUserConfig } from './useUserConfig'
import type { Theme } from '../types/userConfig'

export const useTheme = () => {
  const { getConfig, updateConfig } = useUserConfig()

  const themeClasses = ['theme-dark', 'theme-light']

  const applyTheme = (theme: Theme) => {
    const root = document.documentElement
    root.classList.remove(...themeClasses)
    root.classList.add(`theme-${theme}`)
  }

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const config = await getConfig()
        const theme = (config?.app?.theme || 'dark') as Theme
        applyTheme(theme)
      } catch {
        applyTheme('dark')
      }
    }
    void loadTheme()
  }, [])

  const setTheme = async (theme: Theme) => {
    applyTheme(theme)
    const config = await getConfig()
    const browserViewLayout = (config?.app as any)?.browserViewLayout || { pagesColWidthPx: 320, detailsColWidthPx: 420 }
    const settingsViewLayout = (config?.app as any)?.settingsViewLayout || { sidebarColWidthPx: 260 }
    await updateConfig({
      app: {
        theme,
        locale: config?.app?.locale || 'ru',
        currentView: config?.app?.currentView || 'browser',
        browserViewLayout,
        settingsViewLayout,
      },
    })
  }

  return { setTheme }
}

