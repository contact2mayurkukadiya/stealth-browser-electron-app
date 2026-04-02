import { configureStore } from '@reduxjs/toolkit';
import browserReducer from './browserSlice';
import bookmarksReducer from './bookmarksSlice';

export const store = configureStore({
  reducer: {
    browser: browserReducer,
    bookmarks: bookmarksReducer,
  },
});

export default store;
