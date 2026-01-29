import './Separate.scss'

export function Separate({ title }: { title?: string }) {
  return (
    <div className="separate">
      <div className="separate__line" />
      {title ? <div className="separate__title">{title}</div> : null}
      <div className="separate__line" />
    </div>
  )
}

