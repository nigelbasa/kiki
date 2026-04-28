import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getPortal } from '@shared/api/client';

const BACKEND_URL = 'http://localhost:8000';

let _socket = null;
const _connectedListeners = new Set();

function getSocket() {
  if (_socket) return _socket;
  _socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    auth: { portal: getPortal() },
    query: { portal: getPortal() },
  });
  _socket.on('connect', () => _connectedListeners.forEach((fn) => fn(true)));
  _socket.on('disconnect', () => _connectedListeners.forEach((fn) => fn(false)));
  return _socket;
}

export function useSocket() {
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    _connectedListeners.add(setConnected);
    setConnected(socket.connected);
    return () => {
      _connectedListeners.delete(setConnected);
    };
  }, [socket]);

  return { socket, connected };
}
