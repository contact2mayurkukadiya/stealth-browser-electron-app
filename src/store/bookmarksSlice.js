import { createSlice } from '@reduxjs/toolkit';

const bookmarksSlice = createSlice({
  name: 'bookmarks',
  initialState: {
    data: { bar: [] },
  },
  reducers: {
    setBookmarks(state, action) {
      state.data = action.payload;
    },
  },
});

export const { setBookmarks } = bookmarksSlice.actions;
export default bookmarksSlice.reducer;
