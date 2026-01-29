import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCurrentView } from '../../store/slices/appSlice'
import type { AppView } from '../../store/slices/appSlice'
import './SidebarNav.scss'

type NavItem = {
  id: AppView
  title: string
  iconClass: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', title: 'Дашборд', iconClass: 'fa-solid fa-gauge-high' },
  { id: 'browser', title: 'Браузер', iconClass: 'fa-solid fa-globe' },
  { id: 'sitemap', title: 'Карта сайта', iconClass: 'fa-solid fa-sitemap' },
  { id: 'settings', title: 'Настройки', iconClass: 'fa-solid fa-gear' },
]

export function SidebarNav() {
  const dispatch = useAppDispatch()
  const currentView = useAppSelector((state) => state.app.currentView)

  return (
    <nav className="sidebar-nav" aria-label="Навигация">
      {NAV_ITEMS.map((item) => {
        const isActive = currentView === item.id
        return (
          <button
            key={item.id}
            type="button"
            className={`sidebar-nav__item ${isActive ? 'sidebar-nav__item--active' : ''}`}
            onClick={() => dispatch(setCurrentView(item.id))}
            aria-label={item.title}
            title={item.title}
            data-label={item.title}
          >
            <i className={item.iconClass} aria-hidden="true" />
          </button>
        )
      })}
    </nav>
  )
}

