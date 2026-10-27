document.getElementById('ping-btn')?.addEventListener('click', async () => {
    const response = await window.electronAPI.ping();
    const responseElement = document.getElementById('ping-response');
    if (responseElement) {
        responseElement.innerText = response;
    }
});