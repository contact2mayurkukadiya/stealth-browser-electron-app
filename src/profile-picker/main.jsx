import React from 'react';
import { createRoot } from 'react-dom/client';
import ProfilePickerApp from './ProfilePickerApp';
import { bootstrapVirtualInput } from '../input/bootstrapVirtualInput.js';

bootstrapVirtualInput();
const container = document.getElementById('profile-picker-root');
createRoot(container).render(<ProfilePickerApp />);
