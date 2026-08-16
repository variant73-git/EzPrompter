import NativeMotionEditor from '../../components/motion-editor/NativeMotionEditor.jsx';

export const metadata = {
  title: 'Native Motion Editor · Uncraft',
};

export default function MotionEditorPage() {
  return <NativeMotionEditor runtimeUrl="/api/native-clone/index.html" />;
}
