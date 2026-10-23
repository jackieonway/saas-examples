import { reportView } from './app'
import { createQiankunAdapter } from './adapter.mjs'
import './styles.css'

// Only qiankun's standard exports are public in the UMD entry.
export const { bootstrap, mount, update, unmount } = createQiankunAdapter(reportView)
