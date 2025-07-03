class HomePage {

    constructor(page) {

        this.page = page
        this.menu = "//img[@alt='menu']"
        this.logout = "//button[normalize-space()='Sign out']"
    }

    async logOutFromApplication() {
        await this.page.click(this.menu)
        await this.page.click(this.logout)
    }
}
module.exports = HomePage