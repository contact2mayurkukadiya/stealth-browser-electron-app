import React from 'react';
import { createRoot } from 'react-dom/client';
import ProfilePickerApp from './ProfilePickerApp';

const container = document.getElementById('profile-picker-root');
createRoot(container).render(<ProfilePickerApp />);
