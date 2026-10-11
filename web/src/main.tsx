import { render } from 'preact';
import { App } from './App.tsx';
import { restoreTheme } from './theme.ts';
import './style.css';

restoreTheme();
render(<App />, document.getElementById('app')!);
