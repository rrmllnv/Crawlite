import { useCallback, useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { hydrateFromConfig } from '../store/slices/appSlice'
import { userConfigManager } from '../utils/userConfig'
import type { UserConfig } from '../types/userConfig'

export const useUserConfig = () => {
  const dispatch = useAppDispatch()
  const theme = useAppSelector((state) => state.app.theme)
  const locale = useAppSelector((state) => state.app.locale)
  const currentView = useAppSelector((state) => state.app.currentView)

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await userConfigManager.load()
        dispatch(hydrateFromConfig(config || null))
      } catch {
        dispatch(hydrateFromConfig(null))
      }
    }
    void loadConfig()
  }, [dispatch])

  const getConfig = useCallback(async (): Promise<UserConfig | null> => {
    try {
      return await userConfigManager.load()
    } catch {
      return null
    }
  }, [])

  const updateConfig = useCallback(async (updates: Partial<UserConfig>): Promise<boolean> => {
    const ok = await userConfigManager.update(updates)
    dispatch(hydrateFromConfig(userConfigManager.getConfig() || null))
    return ok
  }, [dispatch])

  const saveApp = useCallback(async (updates?: Partial<UserConfig['app']>) => {
    const ok = await userConfigManager.update({
      app: {
        theme,
        locale,
        currentView,
        ...(updates || {}),
      },
    })
    dispatch(hydrateFromConfig(userConfigManager.getConfig() || null))
    return ok
  }, [theme, locale, currentView, dispatch])

  return {
    theme,
    locale,
    currentView,
    getConfig,
    updateConfig,
    saveApp,
  }
}

