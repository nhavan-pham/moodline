import { useParams } from 'react-router-dom'

export default function Profile() {
  const { username } = useParams()
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">@{username}</h1>
    </div>
  )
}
