import gradio as gr

from logic import run

demo = gr.Interface(
    fn=run,
    inputs=gr.Textbox(label="Input"),
    outputs=gr.Textbox(label="Result"),
    title="{{title}}",
)

if __name__ == "__main__":
    demo.launch()
