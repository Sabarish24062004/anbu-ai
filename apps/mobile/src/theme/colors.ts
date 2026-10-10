import { useColorScheme } from 'react-native';

const light = {
  background: '#FAF7F2',
  surface: '#FFFFFF',
  text: '#1C1B1A',
  textMuted: '#5C5853',
  border: '#E4DED5',
  primary: '#B4471F',
  onPrimary: '#FFFFFF',
  success: '#1E7A3E',
  warning: '#9A6200',
  danger: '#B3261E',
};

const dark: typeof light = {
  background: '#141312',
  surface: '#1F1D1B',
  text: '#F3EFEA',
  textMuted: '#B3ADA6',
  border: '#36322E',
  primary: '#F08A5D',
  onPrimary: '#1C1B1A',
  success: '#6FCF8E',
  warning: '#F2B24C',
  danger: '#FF8A80',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
