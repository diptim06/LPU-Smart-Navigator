import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const LPU_COORDINATES: [number, number] = [31.2536, 75.7037]
const INITIAL_ZOOM = 16

export const MapView = () => {
  return (
    <div className="h-screen w-screen m-0 p-0 overflow-hidden">
      <MapContainer
        center={LPU_COORDINATES}
        zoom={INITIAL_ZOOM}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </MapContainer>
    </div>
  )
}

export default MapView
